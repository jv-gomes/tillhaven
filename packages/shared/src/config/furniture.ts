import { OBJ_TINY_HOUSE } from './assets.js';

/**
 * Furniture, and the room it goes in (CLAUDE.md §5.5).
 *
 * Every crop window below was measured from the alpha bounds of the OLD
 * pack's `interior.png`, deleted along with the rest of the old pack in
 * T-7.07. No task anywhere in Phase 7 claims a furniture/interior art
 * rewire (unlike the player, crops, animals and house/coop/barn, which have
 * T-8.03/T-7.08/T-7.10/T-7.11) — a real gap, flagged here the same way
 * T-7.04 flagged the house/coop/barn one that became T-7.11.
 *
 * `FURNITURE_SHEET` below points at `OBJ_TINY_HOUSE` purely as a bounds-safe
 * stand-in: it is a real, still-loaded new-pack image big enough that every
 * crop window below stays inside it (needed up to x=141,y=112; the house kit
 * is 688x368), so nothing throws when a piece is placed. The crop windows
 * still name pixels that were measured against the OLD interior art and now
 * land on arbitrary, unrelated parts of a house exterior — cosmetically
 * nonsense until this gap gets its own task, the same "looks broken until
 * rewired" state T-7.07 already sanctions for plots/crops/animals.
 *
 * **Footprint is `ceil(size / 16)`**, derived rather than judged. A taller
 * piece therefore occupies the cell its back covers, which is both simpler to
 * reason about and honest about what the sprite hides: you cannot slide a rug
 * under the top half of a fireplace, because on screen you could not see it.
 */

/**
 * The room, in cells.
 *
 * A plain rectangle, not an authored tilemap: `Interior.png` is furniture only —
 * it has no floor or wall tiles — so there is no interior art to lay out. The
 * client draws the room, and the server validates against these bounds. If
 * interior tiles are ever added, this becomes a map like the farm's and the
 * bounds come from it instead.
 */
export const INTERIOR_ROOM = { width: 10, height: 8 } as const;

export interface FurnitureDef {
  readonly id: string;
  readonly name: string;
  /** Crop window into `interior.png`, in pixels. */
  readonly crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Floor space in cells, derived from the crop. */
  readonly footprint: { readonly width: number; readonly height: number };
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
  x: number,
  y: number,
  width: number,
  height: number,
  price: number,
  opts: { vipOnly?: boolean } = {},
): FurnitureDef {
  return {
    id,
    name,
    crop: { x, y, width, height },
    footprint: { width: Math.ceil(width / 16), height: Math.ceil(height / 16) },
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
const DEFS: readonly FurnitureDef[] = [
  // --- floor pieces ---
  piece('rug', 'Rug', 0, 82, 48, 30, 900),
  piece('bed', 'Bed', 80, 52, 32, 24, 1_400),
  piece('bed_tall', 'Bunk Bed', 87, 8, 18, 34, 1_800),
  piece('fireplace', 'Fireplace', 115, 8, 26, 40, 2_500),
  piece('table', 'Table', 68, 120, 24, 23, 700),
  piece('chair', 'Chair', 2, 125, 11, 18, 250),
  piece('stool', 'Stool', 18, 127, 11, 16, 180),
  piece('dresser', 'Dresser', 96, 120, 16, 18, 600),

  // --- trinkets ---
  piece('clock', 'Clock', 1, 18, 13, 13, 350),
  piece('picture', 'Picture', 18, 1, 12, 15, 300),
  piece('plant', 'Potted Plant', 4, 1, 8, 15, 200),
  piece('window', 'Window', 1, 48, 14, 16, 400),

  /*
   * VIP-exclusive cosmetics (§7).
   *
   * Convenience and looks only, and NEVER tradeable — a paying account that
   * could mint tradeable value would wreck an economy with informal RMT around
   * it. They still cost gold: VIP is the gate, gold is still the sink.
   */
  piece('curtains', 'Silk Curtains', 16, 47, 48, 17, 1_200, { vipOnly: true }),
  piece('picture_gilt', 'Gilt Portrait', 18, 18, 13, 13, 800, { vipOnly: true }),
];

export const FURNITURE: Readonly<Record<string, FurnitureDef>> = Object.freeze(
  Object.fromEntries(DEFS.map((d) => [d.id, d])),
);

export const FURNITURE_IDS = DEFS.map((d) => d.id);

export function getFurniture(id: string): FurnitureDef | undefined {
  return FURNITURE[id];
}

/** The sheet every piece is cropped from. */
export const FURNITURE_SHEET = OBJ_TINY_HOUSE;

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
 * True when two placements share any cell.
 *
 * Standard rectangle overlap. Kept here rather than in the service so the
 * client can grey out an illegal drop without a round trip — and so both sides
 * are answering the question the same way (§4.4). The server still decides.
 */
export function overlaps(
  a: { def: FurnitureDef; x: number; y: number },
  b: { def: FurnitureDef; x: number; y: number },
): boolean {
  return (
    a.x < b.x + b.def.footprint.width &&
    b.x < a.x + a.def.footprint.width &&
    a.y < b.y + b.def.footprint.height &&
    b.y < a.y + a.def.footprint.height
  );
}
