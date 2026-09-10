import { describe, expect, it } from 'vitest';
import {
  DECOR,
  FARM_HEIGHT,
  PLOT_POSITIONS,
  type DecorDef,
} from '@tillhaven/shared';
import { checkReachable } from './reachability.js';

/**
 * T-15.19. The flood fill exists so that a player cannot brick their own farm
 * shut with the shop — the only way to remove a piece is to walk up to it and
 * face it, so a fence that seals you out is permanent.
 *
 * These tests are mostly about the SHAPE of a bad placement rather than about
 * specific coordinates: a ring is refused, a ring with a gap is not.
 */

const TIERS = { coop: 0, barn: 0 };
const post: DecorDef = DECOR.fence_v!;
const berry: DecorDef = DECOR.berry_pile!;

/** A full-height wall of solid posts at column `x`. */
function wall(x: number, skip?: number) {
  const out = [];
  for (let y = 0; y < FARM_HEIGHT; y++) {
    if (y === skip) continue;
    out.push({ def: post, x, y });
  }
  return out;
}

describe('checkReachable', () => {
  it('passes on an undecorated farm', () => {
    const result = checkReachable({ tiers: TIERS, placements: [] });
    expect(result.unreachable).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('passes with scattered decoration', () => {
    const result = checkReachable({
      tiers: TIERS,
      placements: [
        { def: post, x: 4, y: 4 },
        { def: post, x: 25, y: 8 },
        { def: berry, x: 6, y: 15 },
      ],
    });
    expect(result.ok).toBe(true);
  });

  /*
   * The headline case. A wall from the top of the map to the bottom cuts the
   * farm in two, and whichever half the spawn is not in becomes unreachable.
   */
  it('refuses a wall that cuts the farm in half', () => {
    const result = checkReachable({ tiers: TIERS, placements: wall(20) });
    expect(result.ok).toBe(false);
    expect(result.unreachable.length).toBeGreaterThan(0);
  });

  /*
   * The control that stops the test above from being about "lots of pieces".
   * The SAME wall with one tile missing is fine — which is the whole design:
   * players may fence, they just have to leave a gate.
   */
  it('allows the same wall with a one-tile gap', () => {
    const sealed = checkReachable({ tiers: TIERS, placements: wall(20) });
    // y=14 is the lane between the coop (rows 7-11) and the barn (rows 16-20).
    const gated = checkReachable({ tiers: TIERS, placements: wall(20, 14) });

    expect(sealed.ok).toBe(false);
    expect(gated.ok, `a gated wall should be legal, blocked: ${gated.unreachable}`).toBe(true);
  });

  /*
   * A gap that opens onto a wall is not a gap.
   *
   * Found while writing the test above, which originally left its gap at y=10 —
   * directly onto the coop's own footprint (rows 7-11) — and was refused. That
   * is correct behaviour and worth pinning: the fill reasons about where you can
   * actually walk, not about how many tiles of fence you left out. A player who
   * leaves their gate against the barn has still sealed the farm, and the game
   * tells them so rather than letting them find out later.
   */
  it('refuses a gap that opens onto a building', () => {
    // Rows 7-11 are the tier-0 coop; rows 16-20 the tier-0 barn.
    for (const gap of [8, 10, 18]) {
      expect(
        checkReachable({ tiers: TIERS, placements: wall(20, gap) }).ok,
        `a gap at y=${gap} opens onto a building and should not count`,
      ).toBe(false);
    }
  });

  it('names what became unreachable, so the client can explain', () => {
    const result = checkReachable({ tiers: TIERS, placements: wall(20) });
    // "yard" replaced "slot" in T-18.04 — see the feedability test below.
    expect(result.unreachable.some((s) => s.includes('yard') || s.includes('plot'))).toBe(true);
    // Whatever the wording, every entry has to be something a player recognises.
    for (const label of result.unreachable) expect(label.trim().length).toBeGreaterThan(0);
  });

  /*
   * Non-solid decoration cannot cut anything off, and the service skips the
   * flood fill entirely for it. Asserted here too, so that if `solidDecorTiles`
   * ever started including walk-over pieces this would catch it.
   */
  it('ignores walk-over decoration however much of it there is', () => {
    const carpet = [];
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < FARM_HEIGHT; y++) carpet.push({ def: berry, x, y });
    }
    expect(checkReachable({ tiers: TIERS, placements: carpet }).ok).toBe(true);
  });

  it('refuses walling the player in at their own spawn', () => {
    const first = PLOT_POSITIONS[0]!;
    const spawn = { x: Math.max(0, first.x - 1), y: first.y };
    const box = [
      { def: post, x: spawn.x - 1, y: spawn.y },
      { def: post, x: spawn.x + 1, y: spawn.y },
      { def: post, x: spawn.x, y: spawn.y - 1 },
      { def: post, x: spawn.x, y: spawn.y + 1 },
    ];
    expect(checkReachable({ tiers: TIERS, placements: box }).ok).toBe(false);
  });

  /*
   * A plot is worked from beside it, so sealing its whole approach ring makes
   * it unusable even though the plot tile itself is still walkable. This is the
   * case a naive "can I reach the plot tile" check would let straight through.
   */
  it('refuses sealing a plot approach ring, even though the plot is walkable', () => {
    const plot = PLOT_POSITIONS[0]!;
    const ring = [
      { def: post, x: plot.x - 1, y: plot.y },
      { def: post, x: plot.x + 1, y: plot.y },
      { def: post, x: plot.x, y: plot.y - 1 },
      { def: post, x: plot.x, y: plot.y + 1 },
    ];
    const result = checkReachable({ tiers: TIERS, placements: ring });
    expect(result.ok).toBe(false);
    expect(result.unreachable.some((s) => s.startsWith('plot'))).toBe(true);
  });

  it('keeps every animal feedable, or says which yard is not reachable', () => {
    // Walling the eastern lane strands the coop and its yard.
    const result = checkReachable({ tiers: TIERS, placements: wall(20) });
    // Labelled by YARD since T-18.04: a slot is no longer one animal's, because
    // the coop's yard moves with its tier and the reservation spans all of them.
    expect(result.unreachable.some((s) => s.includes('coop') || s.includes('barn'))).toBe(true);
  });
});
