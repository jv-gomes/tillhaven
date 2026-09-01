/**
 * The right-hand panels: layer list, plot list, selected-object readout.
 *
 * These are rebuilt wholesale on every change rather than diffed. The lists are
 * at most a few dozen rows, so a full rebuild is cheaper to reason about than
 * incremental updates, and it removes a whole class of stale-DOM bug.
 */

import { fromGid, plotUnlockCost } from '@tillhaven/shared/config';
import type { Layer, MapDoc } from '../model/doc.js';
import { objectLayer, plotLayer } from '../model/doc.js';

export interface LayerPanelHandlers {
  onSelect(id: string): void;
  onToggleVisible(id: string): void;
}

function layerKindLabel(layer: Layer): string {
  if (layer.kind === 'tile') return 'tiles';
  if (layer.kind === 'object') return 'objects';
  return 'plots';
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
