/**
 * The right-hand panels: layer list, plot list, animation picker, collision
 * count, selected-object readout.
 *
 * These are rebuilt wholesale on every change rather than diffed. The lists are
 * at most a few dozen rows, so a full rebuild is cheaper to reason about than
 * incremental updates, and it removes a whole class of stale-DOM bug.
 */

import type { AnimFrame, GroundAnimation } from '@tillhaven/shared/config';
import {
  animationProblems,
  animationWarnings,
  fromGid,
  isBuiltinAnimationId,
  plotUnlockCost,
  SEA_ANIMATION_ID,
  runByKey,
} from '@tillhaven/shared/config';
import type { Layer, MapDoc } from '../model/doc.js';
import { animLayer, collisionLayer, objectLayer, plotLayer } from '../model/doc.js';

export interface LayerPanelHandlers {
  onSelect(id: string): void;
  onToggleVisible(id: string): void;
}

/**
 * Every kind, named.
 *
 * A `switch` rather than a chain ending in a default, so adding a sixth layer
 * kind is a compile error here instead of a list that quietly calls it "plots"
 * — which is exactly what the animation and collision layers looked like until
 * the browser showed three rows labelled the same thing.
 */
function layerKindLabel(layer: Layer): string {
  switch (layer.kind) {
    case 'tile':
      return 'tiles';
    case 'object':
      return 'objects';
    case 'plots':
      return 'plots';
    case 'anim':
      return 'animated';
    case 'collision':
      return 'collision';
  }
}

export function renderLayers(
  host: HTMLElement,
  doc: MapDoc,
  activeId: string,
  handlers: LayerPanelHandlers,
): void {
  host.replaceChildren();

  // Top of the list is the topmost layer, which is the reverse of the document
  // order (Tiled stores bottom-first). Matching every other editor here avoids
  // a permanent low-grade confusion.
  for (const layer of [...doc.layers].reverse()) {
    const li = document.createElement('li');
    li.setAttribute('aria-selected', String(layer.id === activeId));

    const eye = document.createElement('input');
    eye.type = 'checkbox';
    eye.checked = layer.visible;
    eye.title = 'Visible';
    eye.addEventListener('click', (ev) => {
      ev.stopPropagation();
      handlers.onToggleVisible(layer.id);
    });

    const name = document.createElement('span');
    name.textContent = layer.name;

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = layerKindLabel(layer);

    li.append(eye, name, kind);
    li.addEventListener('click', () => handlers.onSelect(layer.id));
    host.append(li);
  }
}

export interface PlotPanelHandlers {
  onReorder(from: number, to: number): void;
  onFocus(x: number, y: number): void;
}

export function renderPlots(
  list: HTMLElement,
  count: HTMLElement,
  doc: MapDoc,
  handlers: PlotPanelHandlers,
): void {
  const layer = plotLayer(doc);
  list.replaceChildren();
  count.textContent = String(layer?.cells.length ?? 0);
  if (!layer) return;

  let dragFrom = -1;

  layer.cells.forEach((cell, index) => {
    const li = document.createElement('li');
    li.draggable = true;

    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String(index);

    const pos = document.createElement('span');
    pos.textContent = `${cell.x},${cell.y}`;

    // Showing the price makes the ordering consequence concrete: dragging a plot
    // to the front is a real economy change, not a cosmetic list tweak.
    const cost = document.createElement('span');
    cost.className = 'cost';
    const gold = plotUnlockCost(index);
    cost.textContent = gold === 0 ? 'free' : `${gold}g`;

    li.append(idx, pos, cost);
    li.addEventListener('click', () => handlers.onFocus(cell.x, cell.y));
    li.addEventListener('dragstart', () => {
      dragFrom = index;
    });
    li.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', (ev) => {
      ev.preventDefault();
      li.classList.remove('drag-over');
      if (dragFrom >= 0 && dragFrom !== index) handlers.onReorder(dragFrom, index);
      dragFrom = -1;
    });

    list.append(li);
  });
}

export function renderObjectInfo(host: HTMLElement, doc: MapDoc, selectedId: number | null): void {
  const layer = objectLayer(doc);
  const object = selectedId === null ? undefined : layer?.objects.find((o) => o.id === selectedId);

  if (!object) {
    host.textContent = 'Nothing selected.';
    return;
  }

  const loc = fromGid(object.gid);
  host.replaceChildren();
  const lines = [
    `${object.name} (#${object.id})`,
    loc ? `${loc.run.key} frame ${loc.frame}` : `gid ${object.gid} — unknown tileset`,
    `at ${object.px},${object.py} px · ${object.w}x${object.h}`,
    `tile ${Math.floor(object.px / doc.tileWidth)},${Math.floor((object.py + object.h - 1) / doc.tileHeight)}`,
  ];
  for (const line of lines) {
    const div = document.createElement('div');
    div.textContent = line;
    host.append(div);
  }
}

/**
 * One frame drawn as a background-positioned box.
 *
 * A CSS sprite rather than a canvas because the strip is rebuilt on every
 * keystroke in the name field, and forty canvases redrawn per keystroke is the
 * kind of cost that shows up as a panel that lags behind your typing. The
 * browser is already caching the sheet image for the palette.
 *
 * Scaled by a whole number, per the asset rules — a fractional scale on 16px
 * art is mush whatever `image-rendering` says.
 */
const FRAME_SCALE = 2;

function frameArt(frame: AnimFrame, scale = FRAME_SCALE): HTMLElement | null {
  const run = runByKey(frame.sheet);
  if (!run) return null;

  const box = document.createElement('span');
  box.className = 'anim-frame__art';
  box.style.backgroundImage = `url(${run.path})`;
  box.style.width = `${run.tileWidth * scale}px`;
  box.style.height = `${run.tileHeight * scale}px`;
  box.style.backgroundSize = `${run.imageWidth * scale}px ${run.imageHeight * scale}px`;
  const col = frame.frame % run.columns;
  const row = Math.floor(frame.frame / run.columns);
  box.style.backgroundPosition = `-${col * run.tileWidth * scale}px -${row * run.tileHeight * scale}px`;
  return box;
}

/**
 * The one thing in this panel that moves.
 *
 * **Authoring an animation is the case where a static strip is not enough.**
 * The strip tells you the order; only playback tells you whether the order
 * *reads* — whether a loop stutters at the seam, whether 6fps is too slow. The
 * old panel was deliberately static on the grounds that "a panel that never
 * settles is one you cannot read while you work", and that still holds for the
 * strip, which is why this is a separate box a few centimetres away rather than
 * the strip itself animating.
 *
 * It owns its timer and is created ONCE. The panels here are rebuilt wholesale
 * on every change; a timer started during a render would be a new timer per
 * keystroke, all of them still running.
 */
export class AnimPreview {
  private readonly host: HTMLElement;
  private timer: number | null = null;
  private frames: readonly AnimFrame[] = [];
  private step = 0;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  /** Points the preview at an animation, or at nothing. Restarts the loop. */
  show(animation: GroundAnimation | undefined): void {
    this.stop();
    this.frames = animation?.frames ?? [];
    this.step = 0;
    this.paint();

    // A single frame is a still image, and a timer swapping it for itself is
    // work that produces nothing. Zero frames is the state a new animation
    // starts in, so it has to render as something rather than as a crash.
    if (!animation || animation.frames.length < 2) return;
    this.timer = window.setInterval(() => {
      this.step = (this.step + 1) % this.frames.length;
      this.paint();
    }, 1000 / animation.fps);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private paint(): void {
    const frame = this.frames[this.step];
    if (!frame) {
      this.host.replaceChildren(document.createTextNode('no frames'));
      return;
    }
    const art = frameArt(frame, FRAME_SCALE * 2);
    this.host.replaceChildren(art ?? document.createTextNode('missing sheet'));
  }
}

export interface AnimPanelDom {
  select: HTMLSelectElement;
  count: HTMLElement;
  /** The name/id/fps fields, disabled for a built-in. */
  name: HTMLInputElement;
  id: HTMLInputElement;
  fps: HTMLInputElement;
  strip: HTMLElement;
  /** Validation and warning text for the selected animation. */
  notes: HTMLElement;
  /** Buttons whose availability depends on what is selected. */
  deleteButton: HTMLButtonElement;
  addFrameButton: HTMLButtonElement;
}

export interface AnimPanelHandlers {
  onSelect(id: string): void;
  onRename(name: string): void;
  onChangeId(nextId: string): void;
  onFps(fps: number): void;
  onRemoveFrame(index: number): void;
  onMoveFrame(from: number, to: number): void;
}

/**
 * The animation picker, its editable frame strip, and the fields that make one.
 *
 * **The strip is still the point, and it is now editable.** An animation is an
 * ordered list of frames that may span sheets, and the order IS the animation —
 * a dropdown of ids tells you nothing about what you are about to stamp.
 * Showing the frames left to right, numbered, means the thing you pick is the
 * thing you saw; dragging them means the order is something you can *fix*
 * without editing TypeScript, which is the whole reason this panel grew.
 *
 * **Built-ins are editable, and editing one keeps its id.** They rendered
 * read-only at first, on the theory that they are derived from measured
 * constants and Duplicate covered the need. It did not: a duplicate has a NEW
 * id, so every cell already stamped with `water-ripple` went on showing the
 * animation you were trying to change. Editing now forks the built-in into an
 * authored entry under the same id — which is what the merge in shared config
 * was written for — and the map follows.
 */
export function renderAnimPanel(
  dom: AnimPanelDom,
  doc: MapDoc,
  animations: readonly GroundAnimation[],
  /** Ids the library carries, so an overridden built-in can be told apart. */
  authoredIds: ReadonlySet<string>,
  selectedId: string,
  handlers: AnimPanelHandlers,
): void {
  const layer = animLayer(doc);
  dom.count.textContent = String(layer?.cells.length ?? 0);

  // Rebuilt whenever the list changed in any visible way, not only when its
  // LENGTH changed: renaming an animation or adding a frame to it both alter
  // every option's label, and a length check would leave the dropdown showing
  // the old text until something happened to be added or removed.
  const signature = animations
    .map((a) => `${a.id} ${a.name} ${a.frames.length} ${a.fps} ${authoredIds.has(a.id)}`)
    .join(' ');
  if (dom.select.dataset['signature'] !== signature) {
    dom.select.replaceChildren(
      ...animations.map((animation) => {
        const option = document.createElement('option');
        option.value = animation.id;
        /*
         * Three states, not two. An overridden built-in still ships under that
         * id but is no longer the shipped VERSION of it, so calling it
         * "(built-in)" would leave the list disagreeing with the notes line
         * right below it about what you are looking at.
         */
        const tag = !isBuiltinAnimationId(animation.id)
          ? ''
          : authoredIds.has(animation.id)
            ? ' (built-in, changed)'
            : ' (built-in)';
        option.textContent =
          `${animation.name} — ${animation.frames.length} frames, ${animation.fps}fps${tag}`;
        return option;
      }),
    );
    dom.select.dataset['signature'] = signature;
  }
  dom.select.value = selectedId;

  const animation = animations.find((a) => a.id === selectedId);
  const nothingSelected = !animation;
  const builtinId = !!animation && isBuiltinAnimationId(animation.id);
  /** A built-in that has already been overridden, i.e. one you can reset. */
  const overridden = builtinId && authoredIds.has(animation.id);

  /*
   * **Everything is editable except the id of a built-in.**
   *
   * Editing a built-in forks it into an authored entry under the same id (see
   * `overrideAnimation`), so the change reaches every cell already stamped with
   * it. Renaming one is the exception: a new id would resurrect the built-in
   * under the old name AND leave a stray animation under the new one, which is
   * two surprises for one keystroke. Duplicate is the operation for that, and
   * it says so in the field's tooltip.
   */
  dom.name.disabled = nothingSelected;
  dom.fps.disabled = nothingSelected;
  dom.addFrameButton.disabled = nothingSelected;
  dom.id.disabled = nothingSelected || builtinId;
  dom.id.title = builtinId
    ? 'A built-in keeps its id so the map keeps working. Use Duplicate to make one with a new id.'
    : '';

  // The same operation, named for what it does here: deleting an override is
  // restoring the built-in, not removing an animation.
  dom.deleteButton.textContent = builtinId ? 'Reset to built-in' : 'Delete';
  dom.deleteButton.disabled = nothingSelected || (builtinId && !overridden);

  // Fields are written only when they differ, so re-rendering mid-edit does not
  // move the caret to the end of what somebody is halfway through typing.
  const setValue = (input: HTMLInputElement, value: string): void => {
    if (input.value !== value) input.value = value;
  };
  setValue(dom.name, animation?.name ?? '');
  setValue(dom.id, animation?.id ?? '');
  setValue(dom.fps, animation ? String(animation.fps) : '');

  dom.name.oninput = () => handlers.onRename(dom.name.value);
  // The id commits on change, not on input: it is the string every map file
  // stores, and rewriting it per keystroke would orphan placements against a
  // dozen half-typed ids on the way to the one that was meant.
  dom.id.onchange = () => handlers.onChangeId(dom.id.value.trim());
  dom.fps.oninput = () => {
    const value = Number(dom.fps.value);
    if (Number.isFinite(value) && value > 0) handlers.onFps(value);
  };

  renderNotes(dom.notes, animation, overridden);
  renderStrip(dom.strip, animation, nothingSelected, handlers);
}

function renderNotes(
  host: HTMLElement,
  animation: GroundAnimation | undefined,
  overridden: boolean,
): void {
  if (!animation) {
    host.textContent = 'No animation selected.';
    host.className = 'hint';
    return;
  }

  const problems = animationProblems(animation);
  const warnings = animationWarnings(animation);

  if (problems.length === 0 && warnings.length === 0) {
    const frames = animation.frames.length;
    const seconds = (frames / animation.fps).toFixed(2);
    // Saying an override IS one matters: otherwise the only sign that a built-in
    // has been changed is the numbers looking unfamiliar, and "why is the water
    // wrong on this machine" is a bad thing to have to work out from nothing.
    const state = overridden ? ' Overrides the built-in.' : '';
    /*
     * Say which animation is the sea. It is an ordinary entry in the list and
     * looks like one, but it is also the backdrop the whole farm floats on —
     * and somebody looking for "how do I change the water around the grass" has
     * no way to guess that "Rippling water" is it.
     */
    const role = animation.id === SEA_ANIMATION_ID ? ' This is the sea behind the farm.' : '';
    host.textContent =
      `${frames} frames at ${animation.fps}fps — one loop is ${seconds}s.${state}${role}`;
    host.className = 'hint';
    return;
  }

  host.className = problems.length > 0 ? 'hint err' : 'hint warn';
  host.replaceChildren(
    ...[...problems, ...warnings].map((line) => {
      const div = document.createElement('div');
      div.textContent = line;
      return div;
    }),
  );
}

/**
 * The frame strip: draggable to reorder, with a remove control per frame.
 *
 * Drag-and-drop rather than up/down buttons because reordering is the edit you
 * make most while an animation is wrong, and it matches the plot list a few
 * centimetres above — one gesture in the panel, not two.
 */
function renderStrip(
  host: HTMLElement,
  animation: GroundAnimation | undefined,
  readOnly: boolean,
  handlers: AnimPanelHandlers,
): void {
  host.replaceChildren();
  if (!animation) return;

  if (animation.frames.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No frames yet. Pick a tile in the palette, then "Add frame".';
    host.append(empty);
    return;
  }

  let dragFrom = -1;

  animation.frames.forEach((frame, index) => {
    const cell = document.createElement('figure');
    cell.className = 'anim-frame';
    cell.draggable = !readOnly;

    const art = frameArt(frame);
    if (art) cell.append(art);
    else {
      const missing = document.createElement('span');
      missing.className = 'anim-frame__art anim-frame__art--missing';
      missing.textContent = '?';
      cell.append(missing);
    }

    const label = document.createElement('figcaption');
    // The index, not the frame number: what matters when reading a loop is the
    // ORDER, and the frame number is only meaningful alongside its sheet, which
    // is what the title attribute is for.
    label.textContent = String(index + 1);
    cell.title = `${frame.sheet} frame ${frame.frame}`;
    cell.append(label);

    if (!readOnly) {
      const remove = document.createElement('button');
      remove.className = 'anim-frame__remove';
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Remove this frame';
      remove.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handlers.onRemoveFrame(index);
      });
      cell.append(remove);

      cell.addEventListener('dragstart', () => {
        dragFrom = index;
      });
      cell.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', (ev) => {
        ev.preventDefault();
        cell.classList.remove('drag-over');
        if (dragFrom >= 0 && dragFrom !== index) handlers.onMoveFrame(dragFrom, index);
        dragFrom = -1;
      });
    }

    host.append(cell);
  });
}

/** How many cells the collision brush has painted. */
export function renderCollisionCount(count: HTMLElement, doc: MapDoc): void {
  count.textContent = String(collisionLayer(doc)?.cells.length ?? 0);
}
