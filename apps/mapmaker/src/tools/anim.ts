/**
 * Stamping animated ground.
 *
 * The third authored thing, after tiles and plots, and deliberately the
 * simplest of the three: a cell either carries an animation or it does not.
 * Order is not meaningful — unlike `PlotLayer`, where array position is the
 * unlock index and `plotUnlockCost` prices it — so nothing here has to preserve
 * a sequence and removal does not renumber anything.
 *
 * **The map records WHERE, never WHAT.** `animId` names an entry in
 * `GROUND_ANIMATIONS`, which owns the frames and the rate. Two maps stamping
 * the same id cannot disagree about how it looks, and re-timing an animation is
 * a config edit rather than a map regeneration.
 */

import type { AnimCell, AnimLayer, MapDoc } from '../model/doc.js';
import { inBounds } from '../model/doc.js';
import type { History } from '../model/history.js';

export function animAt(layer: AnimLayer, x: number, y: number): AnimCell | undefined {
  return layer.cells.find((c) => c.x === x && c.y === y);
}

/**
 * Sets, replaces or clears one cell.
 *
 * **One animation per cell.** Stamping over an existing placement replaces it
 * rather than layering — two animations on one cell would be two sprites at the
 * same depth, and which one you see would come down to insertion order. Passing
 * `null` clears.
 *
 * Returns true if the layer changed, so a caller can skip an undo entry for a
 * click that stamped what was already there.
 */
export function setAnim(
  doc: MapDoc,
  layer: AnimLayer,
  history: History,
  x: number,
  y: number,
  animId: string | null,
): boolean {
  if (!inBounds(doc, x, y)) return false;

  const existing = animAt(layer, x, y);
  if (existing?.animId === animId) return false;
  if (!existing && animId === null) return false;

  const before = layer.cells;
  const without = before.filter((c) => !(c.x === x && c.y === y));
  const after = animId === null ? without : [...without, { x, y, animId }];

  history.recordAnim(layer.id, before, after);
  layer.cells = after;
  return true;
}

/**
 * Re-points every cell stamped with one id at another.
 *
 * **Renaming an animation would otherwise orphan the map**, because the map
 * stores the id and only the id (see the file header). Changing `puddle` to
 * `pond` in the library leaves every `puddle` cell naming something that no
 * longer exists — the symptom in the game is a console warning and a bare patch
 * of ground, which is a long way from the rename that caused it.
 *
 * Only the map open in the editor can be fixed this way. Any OTHER saved map
 * that stamped the old id is still orphaned, which is why the panel warns
 * rather than treating a rename as free.
 *
 * Returns how many cells moved, so the caller can say so.
 */
export function renameAnimId(
  layer: AnimLayer,
  history: History,
  from: string,
  to: string,
): number {
  if (from === to) return 0;
  const before = layer.cells;
  const affected = before.filter((c) => c.animId === from).length;
  if (affected === 0) return 0;

  const after = before.map((c) => (c.animId === from ? { ...c, animId: to } : c));
  history.recordAnim(layer.id, before, after);
  layer.cells = after;
  return affected;
}

export function clearAnims(layer: AnimLayer, history: History): void {
  if (layer.cells.length === 0) return;
  history.recordAnim(layer.id, layer.cells, []);
  layer.cells = [];
}
