import {
  CHEST_TILE,
  FARM_HEIGHT,
  FARM_WIDTH,
  MERCHANT_TILE,
  SHIPPING_BOX_TILE,
  PLOT_POSITIONS,
  reservedFarmTiles,
  authoredCollisionTiles,
  solidDecorTiles,
  yardTilesAcrossTiers,
  type DecorDef,
} from '@tillhaven/shared';

/**
 * Refuses a placement that would cut the player off from part of their own farm
 * (T-15.19, D-9).
 *
 * **This is what makes solid decoration safe to allow at all.** Without it, a
 * player can buy twenty fence pieces and wall themselves out of their field,
 * their chest, or their coop — permanently, because the only way to remove a
 * piece is to walk up to it and face it. A farm that can be bricked shut by its
 * own owner using nothing but the shop is not a feature, and "don't do that" is
 * not a design.
 *
 * `canPlaceDecor` already refuses a solid piece orthogonally beside a plot,
 * which handles the field. This handles everything else: the walk *to* the
 * field, and to the chest, the merchant, the shipping box and both yards.
 *
 * A plain breadth-first flood fill over 660 tiles. It runs inside the placement
 * transaction, once per placement, on a grid smaller than most sprites — there
 * is no cleverness to justify here.
 *
 * **Whole TILES, deliberately, now that the client collides in sub-tile cells.**
 * The client's grid is three times finer on each axis, and it is a strict
 * SUBSET of this one: a cell is only ever solid inside a tile this flood fill
 * already calls solid, and `cells.test.ts` asserts that for every shipped
 * building at every tier. So this fill can only ever be *stricter* than the
 * client — it may refuse a placement that would in fact have left a gap the
 * player could squeeze through, and it can never approve one that traps them.
 *
 * That is the safe direction and it is why the guard was not made finer. It is
 * also a gap worth knowing about: the server is now APPROXIMATING a client
 * rule rather than mirroring it, so "the server said no but I can see the way
 * through" is a possible and acceptable complaint, while "the server said yes
 * and I am walled in" remains impossible. If the two ever need to agree
 * exactly, the subset test is where that assumption is written down.
 */

const key = (x: number, y: number): string => `${x},${y}`;

/** Where the player starts, and therefore what "reachable" is measured from. */
function spawnTile(): { x: number; y: number } {
  // The first plot's western neighbour — the same corner `spawnPoint()` puts
  // the character on in the Farm scene. Derived rather than written down, so a
  // field that moves takes its spawn with it.
  const first = PLOT_POSITIONS[0]!;
  return { x: Math.max(0, first.x - 1), y: first.y };
}

/**
 * Everything the player must still be able to walk to.
 *
 * Plots are represented by their **approach ring**, not by the plot tile: you
 * work a plot by standing beside it and facing it, so a plot whose four
 * neighbours are all sealed is unusable even though the plot itself is
 * walkable. One free neighbour is enough.
 */
function goals(): { label: string; anyOf: { x: number; y: number }[] }[] {
  const out: { label: string; anyOf: { x: number; y: number }[] }[] = [];

  for (const plot of PLOT_POSITIONS) {
    out.push({
      label: `plot (${plot.x},${plot.y})`,
      anyOf: [
        { x: plot.x - 1, y: plot.y },
        { x: plot.x + 1, y: plot.y },
        { x: plot.x, y: plot.y - 1 },
        { x: plot.x, y: plot.y + 1 },
      ],
    });
  }

  // The interactables. Each is itself solid, so the goal is standing beside it.
  for (const [label, tile] of [
    ['the chest', CHEST_TILE],
    ['the merchant', MERCHANT_TILE],
    ['the shipping box', SHIPPING_BOX_TILE],
  ] as const) {
    out.push({
      label,
      anyOf: [
        { x: tile.x - 1, y: tile.y },
        { x: tile.x + 1, y: tile.y },
        { x: tile.x, y: tile.y - 1 },
        { x: tile.x, y: tile.y + 1 },
        { x: tile.x + 1, y: tile.y + 1 },
      ],
    });
  }

  /*
   * Every animal has to stay feedable, so every yard slot needs a free
   * neighbour. Animals themselves are walk-through (D-14), so the slot tile is
   * a legitimate answer too.
   *
   * Across every tier (T-18.04): the coop's yard follows its roof, so a
   * placement that only leaves today's flock reachable could strand tomorrow's.
   */
  for (const tile of yardTilesAcrossTiers()) {
    out.push({
      label: `the ${tile.building} yard (${tile.x},${tile.y})`,
      anyOf: [
        tile,
        { x: tile.x - 1, y: tile.y },
        { x: tile.x + 1, y: tile.y },
        { x: tile.x, y: tile.y - 1 },
        { x: tile.x, y: tile.y + 1 },
      ],
    });
  }

  return out;
}

export interface ReachabilityInput {
  readonly tiers: { readonly coop: number; readonly barn: number };
  /** Every piece that would be placed, INCLUDING the candidate. */
  readonly placements: readonly { readonly def: DecorDef; readonly x: number; readonly y: number }[];
}

export interface ReachabilityResult {
  readonly ok: boolean;
  /** What became unreachable, for the error payload. Empty when ok. */
  readonly unreachable: readonly string[];
}

/**
 * Flood-fills the walkable farm and reports anything the player could no longer
 * get to.
 *
 * "Walkable" here is deliberately more generous than the client's collision:
 * plots and yard slots count as walkable, because the player really can stand
 * on them. Only reserved terrain (water, buildings, map objects) and SOLID
 * decor block. Being stricter than the client would refuse placements that are
 * actually fine; being looser would let one through that traps someone.
 */
export function checkReachable(input: ReachabilityInput): ReachabilityResult {
  const reserved = reservedFarmTiles(input.tiers);

  /*
   * Plots and yard slots are in `reservedFarmTiles` because nothing may be
   * PLACED on them — but the player may stand on them, so they must not block
   * the flood fill. Two different questions about the same tiles.
   */
  const standable = new Set<string>();
  for (const plot of PLOT_POSITIONS) standable.add(key(plot.x, plot.y));
  for (const tile of yardTilesAcrossTiers()) standable.add(key(tile.x, tile.y));

  const blocked = new Set<string>();
  for (const k of reserved) if (!standable.has(k)) blocked.add(k);
  for (const tile of solidDecorTiles(input.placements)) blocked.add(key(tile.x, tile.y));

  /*
   * Collision the MAP authors, over and above what the art blocks.
   *
   * **This is what keeps the guard honest once the collision brush exists.**
   * Authored cells are additive: they can narrow a corridor the art leaves
   * open, and a fill that did not know about them would happily approve a fence
   * that completes the trap. `authoredCollisionTiles` returns every tile the
   * cells TOUCH rather than only tiles they fill, which is the conservative
   * reading and the right one here — refusing a placement that would have been
   * fine is safe, and approving one that walls the player in is not.
   *
   * A plot or yard slot with authored collision on it stays standable, for the
   * same reason it does above: two different questions about the same tile.
   */
  for (const tile of authoredCollisionTiles()) {
    const k = key(tile.x, tile.y);
    if (!standable.has(k)) blocked.add(k);
  }

  const start = spawnTile();
  const reached = new Set<string>();

  // If the player's own spawn is walled in, everything is unreachable and the
  // placement is refused wholesale — no need to enumerate.
  if (!blocked.has(key(start.x, start.y))) {
    const queue = [start];
    reached.add(key(start.x, start.y));

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
        if (nx < 0 || ny < 0 || nx >= FARM_WIDTH || ny >= FARM_HEIGHT) continue;
        const k = key(nx, ny);
        if (reached.has(k) || blocked.has(k)) continue;
        reached.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
  }

  const unreachable: string[] = [];
  for (const goal of goals()) {
    const ok = goal.anyOf.some(
      (t) =>
        t.x >= 0 && t.y >= 0 && t.x < FARM_WIDTH && t.y < FARM_HEIGHT && reached.has(key(t.x, t.y)),
    );
    if (!ok) unreachable.push(goal.label);
  }

  return { ok: unreachable.length === 0, unreachable };
}
