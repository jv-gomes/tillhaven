/**
 * The geometry two placement systems share (T-15.16).
 *
 * The house's furniture (v1) and the farm's outdoor decor (Phase 15) are
 * deliberately separate systems — see D-11, and the note at the top of
 * `decor.ts` — but "do these two footprints overlap" is the same question in
 * both, and it was already written once in `furniture.ts`. Eight lines of
 * rectangle arithmetic is not worth two copies that can disagree.
 *
 * Everything else about the two differs, which is why only this moved.
 */

/** Anything occupying a rectangle of cells, anchored at its top-left. */
export interface Placeable {
  readonly x: number;
  readonly y: number;
  readonly footprint: { readonly width: number; readonly height: number };
}

/**
 * True when two placements share any cell.
 *
 * Named `placementsOverlap` rather than `overlaps` because `furniture.ts`
 * already exports an `overlaps` over its own type, and both are re-exported
 * from `config/index.ts` — the same reason `buildings.ts` says
 * `footprintsOverlap`.
 *
 * Half-open on the far edges (`<`, not `<=`): a piece at x=0 that is 2 wide
 * occupies cells 0 and 1, so a piece at x=2 sits beside it rather than on it.
 * Getting that wrong is a one-character change that either forbids legal
 * placements or lets pieces stack invisibly.
 */
export function placementsOverlap(a: Placeable, b: Placeable): boolean {
  return (
    a.x < b.x + b.footprint.width &&
    b.x < a.x + a.footprint.width &&
    a.y < b.y + b.footprint.height &&
    b.y < a.y + a.footprint.height
  );
}

/** Every cell a placement covers. */
export function cellsOf(placement: Placeable): { x: number; y: number }[] {
  const cells = [];
  for (let dy = 0; dy < placement.footprint.height; dy++) {
    for (let dx = 0; dx < placement.footprint.width; dx++) {
      cells.push({ x: placement.x + dx, y: placement.y + dy });
    }
  }
  return cells;
}
