import {
  INTERIOR_ROOM,
  INTERIOR_SPAWN_TILE,
  FLOOR_TOP,
  solidFurnitureTiles,
  type FurnitureDef,
} from '@tillhaven/shared';

/**
 * Refuses a placement that would seal the player in, or seal a piece away from
 * them (T-18.08, the interior counterpart of `modules/decor/reachability.ts`).
 *
 * **This is what makes solid furniture safe to allow at all**, and its absence
 * is the reason `Interior.buildWorld` had been leaving furniture walk-through:
 * the room is twelve by six, so three pieces can wall off a corner, and the
 * only way to remove a piece is to walk up to it and face it. Solid furniture
 * without this check is a wardrobe you can put in front of yourself and never
 * move again — the trap D-14 describes, in a much smaller room.
 *
 * Two things have to survive every placement:
 *
 *   1. **The spawn cell stays clear.** It is where the player materialises on
 *      entering and the only cell the door can be faced from, so a bed on it
 *      means walking into your own house and standing inside the furniture.
 *   2. **Every placed piece keeps a reachable neighbour.** You remove a piece
 *      by standing beside it and facing it. A piece with no free cell around
 *      it, or whose free cells are cut off from the spawn, is in the room
 *      forever.
 *
 * A breadth-first fill over 72 cells, run inside the placement transaction. As
 * with the farm's, there is no cleverness here to justify.
 *
 * Coordinates are ROOM cells (`INTERIOR_ROOM`), the same space placements are
 * stored in — `FLOOR_TOP` is only used to say why row 0 needs no wall check.
 *
 * **Room cells are whole TILES**, unaffected by the client's move to sub-tile
 * collision. The interior has no measured silhouettes: walls and furniture are
 * both authored by the tile and `Interior.buildWorld` converts them whole, so
 * the finer grid is exactly this one multiplied by three and the fill's answer
 * is unchanged. The farm's counterpart carries the longer note about why a
 * whole-tile fill stays correct against a finer client.
 */

const key = (x: number, y: number): string => `${x},${y}`;

/** The room cell the player stands on when they walk through the door. */
export const SPAWN_CELL = {
  x: INTERIOR_SPAWN_TILE.x,
  // `INTERIOR_SPAWN_TILE` is a MAP tile; the floor starts `FLOOR_TOP` rows down.
  y: INTERIOR_SPAWN_TILE.y - FLOOR_TOP,
} as const;

export interface InteriorPlacement {
  readonly def: FurnitureDef;
  readonly x: number;
  readonly y: number;
  /** For the refusal message. The candidate may pass its own name. */
  readonly label: string;
}

export interface InteriorReachability {
  readonly ok: boolean;
  /** What could no longer be reached. Empty when ok. */
  readonly unreachable: readonly string[];
}

function inRoom(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < INTERIOR_ROOM.width && y < INTERIOR_ROOM.height;
}

/**
 * Flood-fills the walkable floor and reports what the player could no longer
 * get to.
 *
 * `placements` must include the CANDIDATE — the question is about the room as
 * it would be, not as it is.
 */
export function checkInteriorReachable(
  placements: readonly InteriorPlacement[],
): InteriorReachability {
  const blocked = new Set<string>();
  for (const tile of solidFurnitureTiles(placements)) blocked.add(key(tile.x, tile.y));

  // Goal 1. Nothing may stand where the player appears. Reported first because
  // it is the failure that would strand someone rather than merely annoy them.
  if (blocked.has(key(SPAWN_CELL.x, SPAWN_CELL.y))) {
    return { ok: false, unreachable: ['the doorway'] };
  }

  const reached = new Set<string>([key(SPAWN_CELL.x, SPAWN_CELL.y)]);
  const queue = [{ x: SPAWN_CELL.x, y: SPAWN_CELL.y }];

  while (queue.length > 0) {
    const at = queue.pop()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = at.x + dx;
      const ny = at.y + dy;
      if (!inRoom(nx, ny)) continue;
      const k = key(nx, ny);
      if (reached.has(k) || blocked.has(k)) continue;
      reached.add(k);
      queue.push({ x: nx, y: ny });
    }
  }

  // Goal 2. Every piece has to stay removable, which means standing beside it.
  const unreachable: string[] = [];
  for (const piece of placements) {
    if (piece.def.flat) continue;

    const around = new Set<string>();
    for (let dy = -1; dy <= piece.def.footprint.height; dy++) {
      for (let dx = -1; dx <= piece.def.footprint.width; dx++) {
        // Orthogonal neighbours of the footprint only: you face one tile, and
        // a diagonal is not a tile you can face.
        const onEdge =
          (dx === -1 || dx === piece.def.footprint.width) !==
          (dy === -1 || dy === piece.def.footprint.height);
        if (!onEdge) continue;
        around.add(key(piece.x + dx, piece.y + dy));
      }
    }

    if (![...around].some((k) => reached.has(k))) unreachable.push(piece.label);
  }

  return { ok: unreachable.length === 0, unreachable };
}
