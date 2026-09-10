import { describe, expect, it } from 'vitest';
import {
  BED_FURNITURE_IDS,
  FURNITURE,
  FURNITURE_IDS,
  STARTING_FURNITURE,
  isBedFurniture,
  INTERIOR_ROOM,
  fitsInRoom,
  furnitureTiles,
  getFurniture,
  overlaps,
  placementProblem,
  solidFurnitureTiles,
  type PlacedPiece,
} from './furniture.js';

/**
 * The placement rule both sides read (T-17.03).
 *
 * `fitsInRoom` and `overlaps` were shared from the start, so client and server
 * have always agreed on each *question*. What was not shared was the order they
 * are asked in and what a failure MEANS — and the client, having drawn its ghost
 * from them, then posted the placement regardless. Pressing the action key on a
 * red ghost asked the server to repeat a refusal that was already on screen.
 *
 * These cases mirror `house.integration.test.ts`'s, deliberately: if the shared
 * rule and the service ever disagree, one of the two suites has to go red.
 */

const clock = getFurniture('clock')!;
const rug = getFurniture('rug')!;
/** 1x2 — the piece that found the bug, by not fitting on the bottom row. */
const plant = getFurniture('plant')!;

function at(id: string, def = clock, x = 0, y = 0): PlacedPiece {
  return { id, def, x, y };
}

describe('placementProblem', () => {
  it('allows a piece on an empty floor', () => {
    expect(placementProblem({ def: clock, x: 2, y: 2 }, [])).toBeNull();
  });

  it('refuses a piece hanging out of the room, as DOES_NOT_FIT', () => {
    for (const [x, y] of [
      [INTERIOR_ROOM.width, 0],
      [0, INTERIOR_ROOM.height],
      [-1, 0],
      [0, -1],
    ] as const) {
      expect(placementProblem({ def: clock, x, y }, []), `${x},${y}`).toBe('DOES_NOT_FIT');
    }
  });

  /**
   * The actual defect, in one case. A potted plant is 17px tall, so its
   * footprint is TWO cells; on the last row it needs a row that does not exist.
   * The ghost drew this red and the client posted it anyway.
   */
  it('refuses a two-cell-tall piece on the bottom row', () => {
    expect(plant.footprint.height).toBe(2);
    const lastRow = INTERIOR_ROOM.height - 1;
    expect(fitsInRoom(plant, 9, lastRow)).toBe(false);
    expect(placementProblem({ def: plant, x: 9, y: lastRow }, [])).toBe('DOES_NOT_FIT');
    // ...and one row up it is fine, so this is a boundary rather than a ban.
    expect(placementProblem({ def: plant, x: 9, y: lastRow - 1 }, [])).toBeNull();
  });

  it('refuses a piece landing on one already there, as OCCUPIED', () => {
    expect(placementProblem({ def: clock, x: 3, y: 3 }, [at('a', clock, 3, 3)])).toBe('OCCUPIED');
  });

  /** Overlap is rectangle intersection, not corner equality. */
  it('refuses a piece that overlaps only partly', () => {
    const existing = [at('rug', rug, 0, 0)];
    const corner = { def: clock, x: rug.footprint.width - 1, y: rug.footprint.height - 1 };
    expect(overlaps(corner, { def: rug, x: 0, y: 0 })).toBe(true);
    expect(placementProblem(corner, existing)).toBe('OCCUPIED');
  });

  it('allows a piece immediately alongside another', () => {
    expect(
      placementProblem({ def: clock, x: rug.footprint.width, y: 0 }, [at('rug', rug, 0, 0)]),
    ).toBeNull();
  });

  /**
   * Fit is checked BEFORE overlap, and the order is what the two error codes
   * hang off: a piece that is both outside the room and on top of something
   * must report the reason the service reports, not the other one.
   */
  it('reports not-fitting ahead of overlapping when both are true', () => {
    const outside = INTERIOR_ROOM.width - 1;
    expect(
      placementProblem({ def: rug, x: outside, y: 0 }, [at('there', clock, outside, 0)]),
    ).toBe('DOES_NOT_FIT');
  });

  /** A MOVE may not collide with itself. */
  it('ignores the piece being moved', () => {
    const existing = [at('self', clock, 4, 4)];
    expect(placementProblem({ def: clock, x: 4, y: 4 }, existing)).toBe('OCCUPIED');
    expect(placementProblem({ def: clock, x: 4, y: 4 }, existing, 'self')).toBeNull();
  });

  /**
   * Every piece in the catalogue has somewhere legal to go. A footprint bigger
   * than the room is a piece nobody can ever place, and the shop would still
   * happily sell it.
   */
  it('leaves every catalogue piece placeable somewhere', () => {
    for (const def of Object.values(FURNITURE)) {
      expect(
        placementProblem({ def, x: 0, y: 0 }, []),
        `${def.id} (${def.footprint.width}x${def.footprint.height}) does not fit an empty room`,
      ).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ *
 * What furniture stands on (T-18.08)
 * ------------------------------------------------------------------ */

/**
 * Furniture became SOLID, which is what finishes BUG-02: a player standing
 * anywhere a piece is drawn was hidden by it, and T-18.01 could only fix the
 * piece's own ground line. The rest of the footprint needed the player kept out
 * of it, not sorted differently.
 */
describe('solidFurnitureTiles', () => {
  const def = (id: string) => FURNITURE[id]!;

  it('covers the WHOLE footprint, not just the base row', () => {
    // The residual T-18.08 exists to close: a 2-row bed whose back row stayed
    // walkable would still hide anyone standing on it.
    const bed = def('bed');
    expect(bed.footprint.height).toBeGreaterThan(1);

    const tiles = solidFurnitureTiles([{ def: bed, x: 3, y: 2 }]);
    expect(tiles).toHaveLength(bed.footprint.width * bed.footprint.height);
    expect(tiles).toContainEqual({ x: 3, y: 2 });
    expect(tiles).toContainEqual({ x: 3, y: 2 + bed.footprint.height - 1 });
  });

  it('lets a flat piece be walked over', () => {
    const rug = def('rug');
    expect(rug.flat).toBe(true);
    expect(solidFurnitureTiles([{ def: rug, x: 0, y: 0 }])).toEqual([]);
    // ...but it still occupies cells for the overlap check, which is a
    // different question: you cannot stack a bed on a rug.
    expect(furnitureTiles({ def: rug, x: 0, y: 0 })).toHaveLength(
      rug.footprint.width * rug.footprint.height,
    );
  });

  /**
   * The rug is the ONLY flat piece, and that is a claim worth pinning rather
   * than a coincidence: everything else in the catalogue is an object standing
   * on the floor, and a piece silently marked flat would be one the player
   * walks through.
   */
  it('marks exactly one piece flat, and it is the rug', () => {
    const flat = FURNITURE_IDS.filter((id) => FURNITURE[id]!.flat);
    expect(flat).toEqual(['rug']);
  });
});

/**
 * Which pieces are beds (MVP re-scope).
 *
 * Sleeping is the only way to recover energy, and it is reached by facing a
 * bed — so a wrong answer here is not cosmetic. Naming a piece that does not
 * exist makes it unreachable; failing to name one that does makes facing it
 * dismantle it instead.
 */
describe('beds', () => {
  it('names only pieces that exist in the catalogue', () => {
    for (const id of BED_FURNITURE_IDS) {
      expect(FURNITURE[id], id).toBeDefined();
    }
  });

  it('recognises every named bed and nothing else', () => {
    for (const id of FURNITURE_IDS) {
      expect(isBedFurniture(id), id).toBe(BED_FURNITURE_IDS.includes(id));
    }
  });

  /**
   * **A new player must start with somewhere to sleep.** Energy is spent from
   * the first action and buying furniture costs gold they have not earned yet;
   * a bedless starting room is a farm that stops after one pass and cannot be
   * restarted.
   */
  it('gives every new house a bed to sleep in', () => {
    const beds = STARTING_FURNITURE.filter((p) => isBedFurniture(p.furnitureId));
    expect(beds.length).toBeGreaterThan(0);
  });

  /** Both beds are beds. A four-poster you cannot sleep in is a trap. */
  it('counts the four-poster as a bed', () => {
    expect(isBedFurniture('bed_tall')).toBe(true);
  });

  it('does not mistake anything else for one', () => {
    for (const id of ['dresser', 'rug', 'table', 'chair', 'fireplace', '']) {
      expect(isBedFurniture(id), id).toBe(false);
    }
  });
});
