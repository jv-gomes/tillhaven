/**
 * Undo/redo.
 *
 * Edits are recorded as diffs rather than whole-document snapshots. A farm-sized map
 * is small enough that snapshots would work, but diffs make one drag-stroke one
 * undo entry for free: the stroke opens a batch, every tile it touches appends
 * to it, and closing the batch pushes a single reversible command.
 *
 * A tile is only recorded the FIRST time a batch touches it, so dragging back
 * and forth over the same cell still undoes to the value it had before the
 * stroke began.
 */

import type {
  AnimCell,
  CollisionCell,
  MapDoc,
  PlacedObject,
  PlotCell,
  TileLayer,
} from './doc.js';
import { layerById } from './doc.js';

/** Nothing on a map this size justifies a deeper stack, and it caps memory. */
const MAX_ENTRIES = 100;

interface TileChange {
  index: number;
  from: number;
  to: number;
}

interface TileEdit {
  kind: 'tiles';
  layerId: string;
  changes: TileChange[];
}

interface ObjectEdit {
  kind: 'objects';
  layerId: string;
  before: PlacedObject[];
  after: PlacedObject[];
}

interface PlotEdit {
  kind: 'plots';
  layerId: string;
  before: PlotCell[];
  after: PlotCell[];
}

interface AnimEdit {
  kind: 'anim';
  layerId: string;
  before: AnimCell[];
  after: AnimCell[];
}

interface CollisionEdit {
  kind: 'collision';
  layerId: string;
  before: CollisionCell[];
  after: CollisionCell[];
}

type Edit = TileEdit | ObjectEdit | PlotEdit | AnimEdit | CollisionEdit;

interface Entry {
  label: string;
  edits: Edit[];
}

export class History {
  private readonly undoStack: Entry[] = [];
  private readonly redoStack: Entry[] = [];
  private batch: Entry | null = null;
  /** Indices already captured in the open batch, keyed by layer id. */
  private touched = new Map<string, Set<number>>();
  private listeners: (() => void)[] = [];

  constructor(private readonly doc: MapDoc) {}

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Open a batch. Nested calls are ignored so a tool can call it defensively. */
  begin(label: string): void {
    if (this.batch) return;
    this.batch = { label, edits: [] };
    this.touched = new Map();
  }

  /**
   * Write a tile through the history so it is undoable. Returns false if the
   * write was a no-op, which lets callers skip redundant redraws.
   */
  setTile(layer: TileLayer, index: number, gid: number): boolean {
    const from = layer.data[index] ?? 0;
    if (from === gid) return false;

    if (this.batch) {
      let seen = this.touched.get(layer.id);
      if (!seen) {
        seen = new Set();
        this.touched.set(layer.id, seen);
      }
      let edit = this.batch.edits.find(
        (e): e is TileEdit => e.kind === 'tiles' && e.layerId === layer.id,
      );
      if (!edit) {
        edit = { kind: 'tiles', layerId: layer.id, changes: [] };
        this.batch.edits.push(edit);
      }
      if (!seen.has(index)) {
        seen.add(index);
        edit.changes.push({ index, from, to: gid });
      } else {
        const existing = edit.changes.find((c) => c.index === index);
        if (existing) existing.to = gid;
      }
    }

    layer.data[index] = gid;
    return true;
  }

  /** Record a wholesale replacement of an object or plot list. */
  recordObjects(layerId: string, before: PlacedObject[], after: PlacedObject[]): void {
    this.batch?.edits.push({
      kind: 'objects',
      layerId,
      before: before.map((o) => ({ ...o })),
      after: after.map((o) => ({ ...o })),
    });
  }

  /**
   * Authored collision, whole-list like the others.
   *
   * A stroke of the collision brush can touch dozens of cells, and recording
   * the whole list per stroke rather than per cell is what makes one drag one
   * undo — the same shape `recordPlots` uses, for the same reason.
   */
  recordCollision(layerId: string, before: CollisionCell[], after: CollisionCell[]): void {
    this.batch?.edits.push({
      kind: 'collision',
      layerId,
      before: before.map((c) => ({ ...c })),
      after: after.map((c) => ({ ...c })),
    });
  }

  /** The animated-ground twin of `recordPlots`, whole-list like it. */
  recordAnim(layerId: string, before: AnimCell[], after: AnimCell[]): void {
    this.batch?.edits.push({
      kind: 'anim',
      layerId,
      before: before.map((c) => ({ ...c })),
      after: after.map((c) => ({ ...c })),
    });
  }

  recordPlots(layerId: string, before: PlotCell[], after: PlotCell[]): void {
    this.batch?.edits.push({
      kind: 'plots',
      layerId,
      before: before.map((c) => ({ ...c })),
      after: after.map((c) => ({ ...c })),
    });
  }

  /** Close the batch. An empty batch is discarded so a click that changed
   *  nothing does not consume an undo slot. */
  commit(): void {
    const batch = this.batch;
    this.batch = null;
    this.touched = new Map();
    if (!batch || batch.edits.length === 0) return;
    if (batch.edits.every((e) => e.kind === 'tiles' && e.changes.length === 0)) return;

    this.undoStack.push(batch);
    if (this.undoStack.length > MAX_ENTRIES) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  private apply(edit: Edit, direction: 'undo' | 'redo'): void {
    const layer = layerById(this.doc, edit.layerId);
    if (!layer) return;

    if (edit.kind === 'tiles' && layer.kind === 'tile') {
      for (const change of edit.changes) {
        layer.data[change.index] = direction === 'undo' ? change.from : change.to;
      }
    } else if (edit.kind === 'objects' && layer.kind === 'object') {
      const source = direction === 'undo' ? edit.before : edit.after;
      layer.objects = source.map((o) => ({ ...o }));
    } else if (edit.kind === 'plots' && layer.kind === 'plots') {
      const source = direction === 'undo' ? edit.before : edit.after;
      layer.cells = source.map((c) => ({ ...c }));
    } else if (edit.kind === 'anim' && layer.kind === 'anim') {
      const source = direction === 'undo' ? edit.before : edit.after;
      layer.cells = source.map((c) => ({ ...c }));
    } else if (edit.kind === 'collision' && layer.kind === 'collision') {
      const source = direction === 'undo' ? edit.before : edit.after;
      layer.cells = source.map((c) => ({ ...c }));
    }
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    // Reverse order: later edits in a batch may depend on earlier ones.
    for (let i = entry.edits.length - 1; i >= 0; i--) {
      const edit = entry.edits[i];
      if (edit) this.apply(edit, 'undo');
    }
    this.redoStack.push(entry);
    this.emit();
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    for (const edit of entry.edits) this.apply(edit, 'redo');
    this.undoStack.push(entry);
    this.emit();
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.batch = null;
    this.emit();
  }
}
