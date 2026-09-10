import { INTERIOR_HEIGHT, INTERIOR_WIDTH, WALL_ROWS } from './interiorLayout.js';
import {
  INTERIOR_BEDS,
  INTERIOR_CARPET,
  INTERIOR_CHAIRS,
  INTERIOR_DRESSERS,
  INTERIOR_FIREPLACES,
  INTERIOR_OPENINGS,
  INTERIOR_OTHERS,
  INTERIOR_TABLES,
  INTERIOR_TRINKETS,
  type ImageSpec,
} from './assets.js';
import { placementsOverlap } from './placement.js';

/**
 * Furniture, and the room it goes in (CLAUDE.md §5.5).
 *
 * **Every crop window here was measured in T-16.08** by
 * `scripts/measure-interior.py`, which flood-fills each kit's opaque pixels and
 * reports the real pieces. They are not guessed, and the labelled contact
 * sheets it writes are the check on the one thing components get wrong —
 * merging pieces that touch, which is exactly how the first pass produced a
 * "dresser" that was three dressers in one box.
 *
 * Until T-16.08 they were measured against the OLD pack's `interior.png`,
 * deleted in T-7.07, with `FURNITURE_SHEET` pointing at the house EXTERIOR as a
 * bounds-safe stand-in so nothing threw. Every piece rendered as an arbitrary
 * slice of a roof. That placeholder is gone.
 *
 * **A sheet per piece, not one sheet for all of them.** The old pack had one
 * furniture file; this one spreads them across nine, so `FurnitureDef.sheet`
 * replaced the module-level `FURNITURE_SHEET` — the same shape `CropDef.sheet`
 * took in T-7.04 for exactly the same reason.
 *
 * **Footprint is `ceil(size / 16)`**, derived rather than judged. A taller
 * piece therefore occupies the cell its back covers, which is both simpler to
 * reason about and honest about what the sprite hides: you cannot slide a rug
 * under the top half of a fireplace, because on screen you could not see it.
 */

/**
 * The room, in cells — **derived from the authored map** (T-16.13, D-17).
 *
 * It was a hand-written 10x8 from T-3.05 until now, and the reason it could be
 * was that there was no map: T-3.05 wrote "there is no interior art to lay out"
 * because the OLD pack had no floor or wall tiles. This one ships
 * `TILESET_HOUSE`, so `interiorLayout.ts` authors a real room and this is what
 * falls out of it — the walkable floor, which is the room minus the wall band.
 *
 * Deriving it is the point rather than tidiness: the server validates
 * placements against these numbers and the client draws the map, so a
 * hand-written constant that drifted from the map would mean a piece the server
 * accepts and the player cannot see, or a visible floor cell that refuses to
 * take furniture. There is now exactly one source.
 */
export const INTERIOR_ROOM = {
  width: INTERIOR_WIDTH,
  height: INTERIOR_HEIGHT - WALL_ROWS,
} as const;

export interface FurnitureDef {
  readonly id: string;
  readonly name: string;
  /** The KIT this piece is cropped out of. One sheet per piece since T-16.08. */
  readonly sheet: ImageSpec;
  /** Measured crop window into `sheet`, in pixels. */
  readonly crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Floor space in cells, derived from the crop. */
  readonly footprint: { readonly width: number; readonly height: number };
  /**
   * True for a piece that is PAINT ON THE FLOOR rather than an object standing
   * on it (T-18.08).
   *
   * The rug is the only one, and it is the whole distinction the interior
   * needed. Everything else in this catalogue stands up, hides whatever is
   * behind it, and is therefore solid; a rug hides nothing and is walked over.
   * Same split the farm already makes between tilled soil (`DEPTH.groundDecal`)
   * and a crop (sorts on its own feet).
   */
  readonly flat: boolean;
  /** Gold price. Every piece is buyable; there is no "not for sale" tier. */
  readonly price: number;
  /**
   * VIP-exclusive cosmetics are never tradeable (§7): a paying player must not
   * be able to mint value the economy then has to absorb.
   */
  readonly tradeable: boolean;
  readonly vipOnly: boolean;
}

function piece(
  id: string,
  name: string,
  sheet: ImageSpec,
  x: number,
  y: number,
  width: number,
  height: number,
  price: number,
  opts: { vipOnly?: boolean; flat?: boolean } = {},
): FurnitureDef {
  return {
    id,
    name,
    sheet,
    crop: { x, y, width, height },
    footprint: { width: Math.ceil(width / 16), height: Math.ceil(height / 16) },
    flat: opts.flat ?? false,
    price,
    /*
     * A VIP exclusive is NEVER tradeable (§7). Everything else is marked
     * tradeable so Phase 4 can offer it, but note that trading furniture is not
     * built — this flag is a statement of intent that `config.test.ts` holds to.
     */
    tradeable: !(opts.vipOnly ?? false),
    vipOnly: opts.vipOnly ?? false,
  };
}

/**
 * The catalogue.
 *
 * **Prices are for flavour, not progression.** Decoration is the one thing in
 * the game you buy purely because you want to look at it, so the range is wide
 * enough to make a big piece feel like a purchase and cheap enough that
 * furnishing a room is not a second job. Nothing here is priced against what it
 * *does*, because none of it does anything (see `config.test.ts`).
 *
 * Roughly: a trinket is an hour of a new player's income, a signature piece is
 * most of a day's.
 */
/**
 * The pieces you can sleep in (MVP re-scope).
 *
 * **Shared, because both sides have to agree about which piece is a bed.** The
 * client decides whether the action key sleeps or puts a piece into storage,
 * and getting that wrong means facing your bed dismantles it. The server does
 * not check it at all — standing at a bed is adjacency, which is client-side
 * UX (§5.1) — so this exists to keep the CLIENT consistent with itself and
 * with the catalogue, not as a gate.
 *
 * Both beds qualify. A four-poster you cannot sleep in would be furniture
 * pretending to be furniture.
 */
export const BED_FURNITURE_IDS: readonly string[] = ['bed', 'bed_tall'];

export function isBedFurniture(furnitureId: string): boolean {
  return BED_FURNITURE_IDS.includes(furnitureId);
}

const DEFS: readonly FurnitureDef[] = [
  // --- floor pieces ---
  // The carpet kit is a 9-slice autotile rather than a row of rugs, so this is
  // a hand-picked 3x3 block containing all four corners — the one crop here
  // that components could not find, because the whole sheet is one blob.
  piece('rug', 'Rug', INTERIOR_CARPET, 16, 0, 48, 48, 900, { flat: true }),
  piece('bed', 'Bed', INTERIOR_BEDS, 7, 50, 18, 34, 1_400),
  // Renamed from "Bunk Bed" in T-16.08: the pack has no bunk beds at all, and
  // the piece this now points at is plainly a four-poster. The ID is unchanged
  // so `docs/economy.md` and the catalogue tests still line up.
  piece('bed_tall', 'Four-poster Bed', INTERIOR_BEDS, 0, 184, 32, 24, 1_800),
  piece('fireplace', 'Fireplace', INTERIOR_FIREPLACES, 34, 6, 28, 42, 2_500),
  piece('table', 'Round Table', INTERIOR_TABLES, 6, 230, 22, 20, 700),
  piece('chair', 'Chair', INTERIOR_CHAIRS, 130, 13, 11, 18, 250),
  piece('stool', 'Stool', INTERIOR_TABLES, 195, 369, 9, 10, 180),
  piece('dresser', 'Dresser', INTERIOR_DRESSERS, 2, 130, 27, 14, 600),

  // --- trinkets ---
  piece('clock', 'Grandfather Clock', INTERIOR_TRINKETS, 145, 3, 13, 29, 350),
  piece('picture', 'Framed Picture', INTERIOR_TRINKETS, 0, 20, 16, 12, 300),
  piece('plant', 'Potted Plant', INTERIOR_TRINKETS, 65, 158, 14, 17, 200),
  /*
   * Was `window` / "Window" until T-16.08, and the rename is a correction
   * rather than a preference: `Doors, windows and curtains.png` turns out to
   * contain nothing but curtains, and the only wall-hung candidates in the pack
   * are the arched panels in `Others.png` — which at 8x are unmistakably
   * mirrors, diagonal glass highlight and all. There is no window art. Renaming
   * the id is free because the house module has been unregistered since T-11.05,
   * so `furniture_owned` and `furniture_placements` have no rows anywhere.
   */
  piece('mirror', 'Standing Mirror', INTERIOR_OTHERS, 1, 7, 14, 25, 400),

  /*
   * VIP-exclusive cosmetics (§7).
   *
   * Convenience and looks only, and NEVER tradeable — a paying account that
   * could mint tradeable value would wreck an economy with informal RMT around
   * it. They still cost gold: VIP is the gate, gold is still the sink.
   */
  piece('curtains', 'Silk Curtains', INTERIOR_OPENINGS, 7, 163, 33, 24, 1_200, { vipOnly: true }),
  piece('picture_gilt', 'Gilt Portrait', INTERIOR_TRINKETS, 1, 35, 13, 13, 800, { vipOnly: true }),
];

export const FURNITURE: Readonly<Record<string, FurnitureDef>> = Object.freeze(
  Object.fromEntries(DEFS.map((d) => [d.id, d])),
);

export const FURNITURE_IDS = DEFS.map((d) => d.id);

export function getFurniture(id: string): FurnitureDef | undefined {
  return FURNITURE[id];
}

/**
 * Every kit the catalogue actually draws from, deduplicated — what `Preload`
 * has to have loaded before an interior renders.
 *
 * Derived from `DEFS` rather than written out, so a piece pointing at a sheet
 * nobody loads is impossible rather than merely unlikely.
 */
export const FURNITURE_SHEETS: readonly ImageSpec[] = [
  ...new Map(DEFS.map((d) => [d.sheet.key, d.sheet])).values(),
];

export interface Placement {
  readonly furnitureId: string;
  /** Top-left cell of the footprint. */
  readonly x: number;
  readonly y: number;
}

/** True when a placement lies wholly inside the room. */
export function fitsInRoom(def: FurnitureDef, x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return false;
  return (
    x + def.footprint.width <= INTERIOR_ROOM.width &&
    y + def.footprint.height <= INTERIOR_ROOM.height
  );
}

/**
 * True when two pieces share a cell.
 *
 * Re-exported from `placement.ts` since T-15.16, where the same rectangle
 * arithmetic serves the farm's outdoor decor. Kept as a named export here so
 * every existing caller and test is untouched — the two systems stay separate
 * (D-11), they just stopped carrying two copies of an overlap check.
 */
export function overlaps(
  a: { def: FurnitureDef; x: number; y: number },
  b: { def: FurnitureDef; x: number; y: number },
): boolean {
  return placementsOverlap(
    { x: a.x, y: a.y, footprint: a.def.footprint },
    { x: b.x, y: b.y, footprint: b.def.footprint },
  );
}

/** A piece already standing in the room. */
export interface PlacedPiece {
  readonly id: string;
  readonly def: FurnitureDef;
  readonly x: number;
  readonly y: number;
}

/**
 * Why a placement cannot happen, or `null` if it can (T-17.03).
 *
 * **The two checks and the ORDER they run in, in one place.** `fitsInRoom` and
 * `overlaps` were already shared, so both sides have always agreed on each
 * question — but each side decided separately which to ask first and what a
 * failure means, and the client only ever asked them to colour a ghost. It then
 * posted the placement regardless, so pressing the action key on a red ghost
 * asked the server to repeat a refusal already on screen.
 *
 * The names map onto the error codes the service throws, deliberately:
 * `DOES_NOT_FIT` is `VALIDATION_FAILED`, `OCCUPIED` is `PLOT_OCCUPIED`.
 *
 * **This does not make the client authoritative** (§4.1). The server still runs
 * both checks inside the placement transaction and is the only thing that
 * decides. This is a client-side UX gate of exactly the kind §5.1 already
 * describes for adjacency and facing — it stops the client asking a question it
 * can already answer, and nothing more.
 *
 * `ignoreId` is for a MOVE: a piece may not overlap itself.
 */
export type PlacementProblem = 'DOES_NOT_FIT' | 'OCCUPIED';

export function placementProblem(
  candidate: { def: FurnitureDef; x: number; y: number },
  existing: Iterable<PlacedPiece>,
  ignoreId?: string,
): PlacementProblem | null {
  if (!fitsInRoom(candidate.def, candidate.x, candidate.y)) return 'DOES_NOT_FIT';

  for (const other of existing) {
    if (other.id === ignoreId) continue;
    if (overlaps(candidate, other)) return 'OCCUPIED';
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * What furniture stands on (T-18.08)
 * ------------------------------------------------------------------ */

/** Every room cell a piece covers. Room coordinates, not map tiles. */
export function furnitureTiles(
  piece: { readonly def: FurnitureDef; readonly x: number; readonly y: number },
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let dy = 0; dy < piece.def.footprint.height; dy++) {
    for (let dx = 0; dx < piece.def.footprint.width; dx++) {
      out.push({ x: piece.x + dx, y: piece.y + dy });
    }
  }
  return out;
}

/**
 * Every room cell the player cannot stand on — the WHOLE footprint of every
 * upright piece.
 *
 * **The whole footprint, not the base row, and that is a deliberate departure
 * from how T-18.08 was written.** The residual it exists to close is that
 * standing on the BACK row of a two-row bed still hides the player; a solid
 * base row alone leaves exactly that, because the back row stays walkable and
 * the sprite still sorts in front of anyone on it. The footprint is already
 * defined as "what the sprite hides" (see the module note above), which is
 * precisely the set of cells where standing would hide the player, so making
 * that set solid is the rule the geometry was already carrying.
 *
 * Flat pieces contribute nothing: a rug is walked over, and drawn under
 * everything at `DEPTH.groundDecal`.
 */
export function solidFurnitureTiles(
  placements: Iterable<{ readonly def: FurnitureDef; readonly x: number; readonly y: number }>,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const piece of placements) {
    if (piece.def.flat) continue;
    out.push(...furnitureTiles(piece));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The house a new player walks into (T-18.25)
 * ------------------------------------------------------------------ */

/**
 * Furniture every new account's house starts with, already placed.
 *
 * **The other half of G-5.** T-18.11 replaced the diagonal-hatch floor so the
 * room stopped reading as *unfinished*; it was still empty. A player who walks
 * through their own front door for the first time should find a room, not a
 * warehouse — and the Decorate tray teaches itself much better from a room that
 * already has something in it to move.
 *
 * **Why this is not the economy decision T-18.11 was worried about.** That note
 * said granting furniture is "a new faucet §5.8 requires documenting" and that
 * the pieces are `tradeable`. Both true, and neither is a reason to stop:
 *
 *   - §5.8 and `docs.test.ts` are about **gold**. This writes
 *     `furniture_placements`, and no gold moves.
 *   - `STARTING_ITEMS` already hands every new account **six tradeable seeds**
 *     plus two tools. A one-off cosmetic grant is the same class of thing the
 *     project already ships, tests and documents — the precedent was sitting
 *     next to it the whole time.
 *
 * **Placed, not banked.** Rows go straight into `furniture_placements` and none
 * into `furniture_owned`, which keeps conservation exact: removing a starter
 * piece returns it to storage, the same as any other. Granting both would let a
 * player remove one and end up with two.
 *
 * The layout leaves the doorway clear and every piece reachable —
 * `checkInteriorReachable` is asserted against it in
 * `modules/house/reachability.test.ts`, so a future rearrangement cannot ship a
 * bed nobody can get to.
 */
export const STARTING_FURNITURE: readonly Placement[] = [
  // Against the west wall, clear of the door at the top-centre.
  { furnitureId: 'bed', x: 0, y: 0 },
  { furnitureId: 'dresser', x: 0, y: 4 },
  // Flat, so it is walked over and drawn under everything (T-18.08).
  { furnitureId: 'rug', x: 4, y: 2 },
  // Something on the far side, so the room does not read as one-sided.
  { furnitureId: 'table', x: 9, y: 1 },
];
