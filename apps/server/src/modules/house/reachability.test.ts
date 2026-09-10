import { describe, expect, it } from 'vitest';
import {
  FURNITURE,
  INTERIOR_ROOM,
  STARTING_FURNITURE,
  fitsInRoom,
  overlaps,
  solidFurnitureTiles,
  type FurnitureDef,
} from '@tillhaven/shared';
import { SPAWN_CELL, checkInteriorReachable, type InteriorPlacement } from './reachability.js';

/**
 * T-18.08 — the guard that makes solid furniture safe.
 *
 * `Interior.buildWorld` left furniture walk-through for two phases with a
 * comment saying exactly why: the room is twelve by six, three pieces can wall
 * off a corner, and the only way to remove a piece is to walk up to it and face
 * it. This is the check that answers that objection, and the same shape
 * `modules/decor/reachability.ts` already had for the farm.
 *
 * The failures here are all permanent-loss failures, which is why they get a
 * flood fill rather than a rule of thumb: a room you cannot leave, or a
 * fireplace you cannot remove, has no in-game remedy at all.
 */

const def = (id: string): FurnitureDef => FURNITURE[id]!;

function place(id: string, x: number, y: number): InteriorPlacement {
  return { def: def(id), x, y, label: def(id).name };
}

/** A 1x1 upright piece, for building walls out of cheaply. */
const UNIT = 'stool';

describe('checkInteriorReachable', () => {
  it('allows an empty room', () => {
    expect(checkInteriorReachable([])).toEqual({ ok: true, unreachable: [] });
  });

  it('allows an ordinary piece against a wall', () => {
    expect(checkInteriorReachable([place('dresser', 0, 0)]).ok).toBe(true);
  });

  /**
   * The failure that would strand someone. `SPAWN_CELL` is where the player
   * materialises on entering AND the only cell the door can be faced from, so a
   * bed on it means walking into your own house and standing inside furniture.
   */
  it('refuses a piece standing on the doorway', () => {
    const result = checkInteriorReachable([place(UNIT, SPAWN_CELL.x, SPAWN_CELL.y)]);

    expect(result.ok).toBe(false);
    expect(result.unreachable).toEqual(['the doorway']);
  });

  it('refuses a piece whose footprint merely covers the doorway', () => {
    // The bed is taller than one cell, so it can reach the spawn from a cell
    // that is not itself the spawn — which an x/y equality check would miss.
    const bed = def('bed');
    const result = checkInteriorReachable([
      place('bed', SPAWN_CELL.x, SPAWN_CELL.y - (bed.footprint.height - 1)),
    ]);

    expect(result.ok).toBe(false);
  });

  /**
   * The other permanent loss: a piece with no free neighbour cannot be faced,
   * and removal is the only way to get it back.
   */
  it('refuses a placement that boxes a piece into a corner', () => {
    // Corner piece at (0,0), then walls at (1,0) and (0,1) seal it in.
    const result = checkInteriorReachable([
      place(UNIT, 0, 0),
      place(UNIT, 1, 0),
      place(UNIT, 0, 1),
    ]);

    expect(result.ok).toBe(false);
    expect(result.unreachable).toContain(def(UNIT).name);
  });

  /**
   * ...and the near miss that must still be allowed, or the check is just
   * "furniture may not touch". Two pieces in a row leave the third's other
   * sides open.
   */
  it('allows two pieces side by side, which is not a trap', () => {
    expect(checkInteriorReachable([place(UNIT, 0, 0), place(UNIT, 1, 0)]).ok).toBe(true);
  });

  /**
   * The whole point of the flood fill rather than a neighbour count: a piece
   * can have four free neighbours and still be unreachable, because the free
   * cells are on the wrong side of a wall.
   */
  it('refuses a wall that seals a region, even with free cells behind it', () => {
    const wall: InteriorPlacement[] = [];
    // A full-height column across the room, one cell in from the east wall,
    // with a piece stranded behind it.
    for (let y = 0; y < INTERIOR_ROOM.height; y++) {
      wall.push(place(UNIT, INTERIOR_ROOM.width - 2, y));
    }
    const stranded = place('plant', INTERIOR_ROOM.width - 1, 0);

    const sealed = checkInteriorReachable([...wall, stranded]);
    expect(sealed.ok).toBe(false);
    expect(sealed.unreachable).toContain(def('plant').name);

    // The control: one gap in that wall and everything is fine again, so the
    // refusal is about the seal and not about the number of pieces.
    const withGap = checkInteriorReachable([...wall.slice(1), stranded]);
    expect(withGap.ok).toBe(true);
  });

  /**
   * A rug cannot cut anything off, so it is not in the fill at all — neither as
   * a blocker nor as something that needs reaching. Pinned because the flat
   * flag is new and a rug that blocked would be a carpet you trip over.
   */
  it('ignores flat pieces entirely', () => {
    const rug = def('rug');
    expect(rug.flat).toBe(true);

    // A rug laid over the doorway is legal — you walk on it.
    const over = checkInteriorReachable([place('rug', SPAWN_CELL.x, SPAWN_CELL.y)]);
    expect(over.ok).toBe(true);

    // And it does not block a piece behind it.
    const behind = checkInteriorReachable([place('rug', 0, 0), place(UNIT, 1, 1)]);
    expect(behind.ok).toBe(true);
  });

  /**
   * The room can be filled with upright furniture right up to the point where
   * something is cut off. Asserted so the guard cannot quietly become "no more
   * than N pieces" — decorating is the entire feature.
   */
  it('allows a heavily furnished room that still has a way round everything', () => {
    const pieces: InteriorPlacement[] = [];
    /*
     * Alternating columns hanging off a corridor along row 0 — the row the
     * spawn is on, so every stub is reachable from the door.
     *
     * The first version of this fixture ran the columns the FULL height and
     * failed, correctly: alternating full-height columns cut the room into
     * vertical corridors that never meet, so most of the furniture is stranded
     * behind a solid column. The check was right and the test was wrong, which
     * is worth recording — "leave a gap between pieces" is not the same rule as
     * "leave a connected floor", and only the second one is true.
     */
    for (let x = 0; x < INTERIOR_ROOM.width; x += 2) {
      for (let y = 1; y < INTERIOR_ROOM.height; y++) pieces.push(place(UNIT, x, y));
    }

    const result = checkInteriorReachable(pieces);
    expect(result.unreachable).toEqual([]);
    expect(pieces.length).toBeGreaterThan(20);
  });
});

/**
 * T-18.25 — the house a new account walks into.
 *
 * `STARTING_FURNITURE` is placed by the registration transaction, which does
 * NOT go through `placeFurniture` and therefore does not run
 * `assertPlaceable`. Nothing else would catch a starter layout that seals the
 * doorway or strands a piece — and it would be shipped to every account that
 * has ever existed rather than to one player who made a mistake.
 */
describe('STARTING_FURNITURE', () => {
  const placed = (): InteriorPlacement[] =>
    STARTING_FURNITURE.map((p) => {
      const def = FURNITURE[p.furnitureId];
      expect(def, `${p.furnitureId} is not in the catalogue`).toBeDefined();
      return { def: def!, x: p.x, y: p.y, label: def!.name };
    });

  it('names only furniture that exists', () => {
    expect(placed()).toHaveLength(STARTING_FURNITURE.length);
  });

  it('fits inside the room', () => {
    for (const { def, x, y } of placed()) {
      expect(fitsInRoom(def, x, y), `${def.name} at (${x},${y})`).toBe(true);
    }
  });

  it('does not overlap itself', () => {
    const pieces = placed();
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i]!;
        const b = pieces[j]!;
        expect(
          overlaps({ def: a.def, x: a.x, y: a.y }, { def: b.def, x: b.x, y: b.y }),
          `${a.label} overlaps ${b.label}`,
        ).toBe(false);
      }
    }
  });

  /**
   * The one that would actually hurt. A starter layout that boxes the player
   * in ships to EVERY account, and the only way out of a sealed room is to
   * remove a piece you cannot walk up to.
   */
  it('leaves the doorway clear and every piece reachable', () => {
    const result = checkInteriorReachable(placed());
    expect(result.unreachable).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('leaves the room mostly empty, so there is somewhere to decorate', () => {
    const solid = solidFurnitureTiles(placed()).length;
    const floor = INTERIOR_ROOM.width * INTERIOR_ROOM.height;
    expect(solid).toBeGreaterThan(0);
    expect(solid / floor, 'a furnished room, not a full one').toBeLessThan(0.3);
  });
});
