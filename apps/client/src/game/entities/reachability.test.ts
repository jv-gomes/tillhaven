import { describe, expect, it } from "vitest";
import {
  BARN_TIER_ART,
  COOP_TIER_ART,
  MAP_OBJECTS,
  VILLAGERS,
  FARM_WIDTH,
  FARM_HEIGHT,
  HOUSE_ANCHOR,
  reservedBy,
  PATHS,
  PLAYER_COLLIDER,
  PLOT_POSITIONS,
  TILE_SIZE,
  WANDER,
  ANIMALS,
  COLLISION_CELL,
  currentBuildingCells,
  tileToCells,
  tilesToCells,
  maxHerd,
  objectAnchorPx,
  pastureSlot,
  pathTiles,
  waterTiles,
} from "@tillhaven/shared/config";
import { seedFrom, wanderPose, wanderTile } from "../animalWander.js";
import { BlockMap, objectCells } from "../collision.js";
import {
  MAX_STEP_MS,
  playerBounds,
  step,
  type MoveState,
  type World,
} from "./movement.js";
import {
  approachFor,
  feetOnTile,
  frameDistance,
  hasArrived,
  replayInput,
  type ReplayPlan,
} from "./idleReplay.js";

/**
 * T-15.09 — the idle farmer can still reach every plot, now that the farm is
 * solid.
 *
 * `idleReplay` walks straight octile lines with no obstacle avoidance, which
 * was fine when nothing obstructed. Rather than give it A* (D-8), this proves
 * the map cannot trap it: drive the real `replayInput` → `step` loop through
 * the real block map, from every direction, to every plot.
 *
 * **A failure here is a map problem, not a pathing problem.** The fix is to
 * move whatever is in the way in `farmLayout.ts` and regenerate — which is what
 * makes "reachable by construction" a mechanical claim rather than a hope. That
 * is exactly how the chest's position was found to be wrong in T-15.08.
 *
 * The replay is cosmetic (§4.1): the server has already decided what the farmer
 * did, and this walk only animates it. So the stakes are "the farmer visibly
 * clips a corner", never "the farm stops working" — hence a test plus a runtime
 * unstick, rather than a pathfinder.
 */

const MAP_W = 30 * TILE_SIZE;
const MAP_H = 22 * TILE_SIZE;
const BOUNDS = playerBounds(MAP_W, MAP_H);

/**
 * The most obstructed the farm can ever be: top-tier coop and barn, the water,
 * every map object, and the shopkeeper.
 *
 * Animals are absent by design (D-14) — livestock is walk-through.
 *
 * The object list comes from `MAP_OBJECTS` (T-18.05) rather than being written
 * out here: it was a hand-kept copy in two test files, and a copy that falls a
 * task behind makes a "worst case" quietly missing whatever was added last.
 */
function worstCaseWorld(): World {
  const map = new BlockMap();
  map.set("terrain", tilesToCells(waterTiles()));
  map.set(
    "buildings",
    currentBuildingCells({
      coop: COOP_TIER_ART.length - 1,
      barn: BARN_TIER_ART.length - 1,
    }),
  );
  map.set("objects", [
    ...objectCells(
      MAP_OBJECTS.map((o) => ({
        key: o.key,
        anchorPx: objectAnchorPx(o.tile),
      })),
    ),
    // Read from `VILLAGERS` rather than naming the shopkeeper, so a new villager
    // joins the worst case automatically — the same fix T-18.05 made for the
    // hand-kept object list above, for the same reason.
    ...VILLAGERS.flatMap((v) => tileToCells(v.tile)),
  ]);

  // `COLLISION_CELL`, not `TILE_SIZE`: the world walks the collision grid,
  // which is three times finer. `step` and `slide` are written entirely in
  // terms of this number, which is why sub-tile collision needed no change to
  // either.
  return {
    blocked: map.blocked,
    collider: PLAYER_COLLIDER,
    tileSize: COLLISION_CELL,
  };
}

/**
 * Is ANY cell of this tile solid?
 *
 * `world.blocked` takes CELL coordinates since sub-tile collision landed, and
 * every question below is about a whole tile — can a cow stand here, is this
 * path tile walkable. Asking `blocked(tileX, tileY)` would silently ask about
 * a cell three times nearer the origin, which is a test that passes for the
 * wrong reason far more often than it fails.
 */
function tileBlocked(world: World, tileX: number, tileY: number): boolean {
  return tileToCells({ x: tileX, y: tileY }).some((c) =>
    world.blocked(c.cx, c.cy),
  );
}

function stateAt(x: number, y: number): MoveState {
  return { x, y, facing: "down", moving: false, running: false };
}

/**
 * Walk the farmer to a plot the way `Farm.driveIdleReplay` does, and report
 * whether it got there.
 *
 * `frames` is generous — 400 frames is 40 seconds of walking, far more than
 * crossing a 30x22 farm needs — because the question is "can it arrive at all",
 * not "how fast".
 */
function walkTo(
  start: { x: number; y: number },
  plot: { x: number; y: number },
  world: World | undefined,
  frames = 400,
): { arrived: boolean; state: MoveState } {
  const plotTile = { tileX: plot.x, tileY: plot.y };
  const approach = approachFor(start, plotTile);
  const plan: ReplayPlan = {
    targetId: `${plot.x},${plot.y}`,
    at: 0,
    kind: "water",
    target: feetOnTile(approach.tile),
    facing: approach.facing,
    travelMs: 0,
    departAt: 0,
  };

  const stepPx = frameDistance(MAX_STEP_MS);
  let state = stateAt(start.x, start.y);

  for (let i = 0; i < frames; i++) {
    if (hasArrived(plan, state, stepPx)) return { arrived: true, state };
    state = step(
      state,
      replayInput(plan, state, 1, stepPx),
      MAX_STEP_MS,
      BOUNDS,
      world,
    );
  }

  return { arrived: hasArrived(plan, state, stepPx), state };
}

/**
 * Start positions spread around the farm, so `approachFor` picks every side.
 *
 * It chooses the side the farmer is already nearest on the axis it is furthest
 * along, so approaching a plot from the north, south, east and west is a matter
 * of starting north, south, east and west of it. These are real walkable tiles
 * on the current map, checked by a test below rather than assumed.
 */
const STARTS = [
  // (4,2) would be inside the north-west maple's trunk — the first version of
  // this list said so, and the free-tile assertion below caught it.
  { name: "north-west", ...feetOnTile({ tileX: 5, tileY: 2 }) },
  { name: "north-east", ...feetOnTile({ tileX: 18, tileY: 2 }) },
  { name: "south-west", ...feetOnTile({ tileX: 5, tileY: 19 }) },
  { name: "south-east", ...feetOnTile({ tileX: 18, tileY: 19 }) },
  { name: "the path spine", ...feetOnTile({ tileX: 8, tileY: 8 }) },
] as const;

describe("idle replay reachability", () => {
  const world = worstCaseWorld();

  it("starts every walk from a tile that is actually free", () => {
    // Otherwise a "passing" reachability run might only be passing because the
    // escape hatch turned collision off on frame one.
    for (const start of STARTS) {
      const tx = Math.floor(start.x / TILE_SIZE);
      const ty = Math.floor((start.y - 1) / TILE_SIZE);
      expect(
        tileBlocked(world, tx, ty),
        `${start.name} (${tx},${ty}) is solid`,
      ).toBe(false);
    }
  });

  it("reaches every plot from every direction, through the worst-case farm", () => {
    const failures: string[] = [];

    for (const plot of PLOT_POSITIONS) {
      for (const start of STARTS) {
        const { arrived, state } = walkTo(start, plot, world);
        if (!arrived) {
          failures.push(
            `plot (${plot.x},${plot.y}) from ${start.name}: stuck at ` +
              `(${state.x.toFixed(1)},${state.y.toFixed(1)})`,
          );
        }
      }
    }

    expect(
      failures,
      "The idle farmer cannot reach some plots. This is a MAP problem: move " +
        "the obstruction in packages/shared/src/config/farmLayout.ts and " +
        "regenerate (see T-15.09).",
    ).toEqual([]);
  });

  /*
   * The control. If collision made no difference to these walks, the test above
   * would prove nothing — it would pass on an empty world just as happily.
   * A wall of blockers across the field must actually stop the farmer.
   */
  it("would fail if the map really did trap the farmer", () => {
    const plot = PLOT_POSITIONS[0]!;
    const start = STARTS[1]!; // north-east, so the farmer walks in from the east

    /*
     * The wall has to sit BETWEEN the farmer and the tile it is walking to,
     * which is not the same as "beside the plot". The first version of this
     * test walled the plot's west side — and the farmer, approaching from the
     * east, stopped on the plot's EAST side and arrived without ever meeting
     * it. A control that the code passes for the wrong reason is worse than no
     * control, so the wall is derived from the actual approach tile.
     */
    const approach = approachFor(start, { tileX: plot.x, tileY: plot.y });
    const startTile = Math.floor(start.x / TILE_SIZE);
    const wallX = Math.floor((approach.tile.tileX + startTile) / 2);

    const map = new BlockMap();
    const wall = [];
    for (let y = 0; y < 22; y++)
      wall.push({ x: wallX, y }, { x: wallX + 1, y });
    map.set("decor", tilesToCells(wall));

    const sealed: World = {
      blocked: map.blocked,
      collider: PLAYER_COLLIDER,
      tileSize: COLLISION_CELL,
    };

    expect(wallX).toBeGreaterThan(approach.tile.tileX);
    expect(wallX).toBeLessThan(startTile);
    expect(walkTo(start, plot, sealed).arrived).toBe(false);
    // ...and the same walk succeeds without the wall, so the wall is the cause.
    expect(walkTo(start, plot, undefined).arrived).toBe(true);
  });

  it("always arrives when collision is off, which is the unstick fallback", () => {
    // T-15.09's runtime escape: if the farmer is stuck for REPLAY_STUCK_MS the
    // scene drops `world` for the rest of that plan. This is what that buys.
    for (const plot of PLOT_POSITIONS) {
      const { arrived } = walkTo(STARTS[0]!, plot, undefined);
      expect(arrived, `plot (${plot.x},${plot.y}) with collision off`).toBe(
        true,
      );
    }
  });
});

/**
 * T-16.06 (D-16) — a roaming cow stays targetable.
 *
 * `Animal.bounds()` follows a cow now, so "which tile does this animal answer
 * on" is no longer a fixed slot. Three things have to hold for that to be safe,
 * and each is the same class of trap D-14 sprang: geometry that is fine at two
 * animals and broken at nine.
 *
 * All three are proved against the WORST-CASE world — top-tier buildings, every
 * object, the water — and at FULL occupancy, because a half-empty barn proves
 * nothing about a full one.
 */
describe("a roaming cow can always be reached and told apart", () => {
  const COW_HERD = maxHerd(ANIMALS.cow.building);

  /** Every tile a cow of this index can come to rest on. */
  function roamTiles(index: number): { x: number; y: number }[] {
    const home = pastureSlot("cow", index, 0);
    const tileX = Math.floor(home.x / TILE_SIZE);
    const tileY = Math.floor((home.y - 1) / TILE_SIZE);
    const { roamTilesUp, roamTilesDown } = WANDER.cow;

    const tiles = [];
    for (let dy = -roamTilesUp; dy <= roamTilesDown; dy++)
      tiles.push({ x: tileX, y: tileY + dy });
    return tiles;
  }

  /**
   * A cow that roamed into the water or under the barn would be a cow you can
   * see and cannot walk up to. Nothing stops it today because animals are not
   * solid (D-14) and the wander does not consult the block map — it is pure
   * arithmetic over its slot — so the band has to be clear by construction.
   */
  it("never roams onto a tile the world blocks", () => {
    const world = worstCaseWorld();
    for (let index = 0; index < COW_HERD; index++) {
      for (const tile of roamTiles(index)) {
        expect(
          tileBlocked(world, tile.x, tile.y),
          `cow #${index} can stand on blocked tile (${tile.x},${tile.y})`,
        ).toBe(false);
      }
    }
  });

  /**
   * Standing on a free tile is not enough: you act on the tile you FACE, so
   * there has to be somewhere to face it from. This is precisely the check that
   * would have caught D-14's unfeedable chickens before they were shipped.
   */
  it("always leaves a tile the player can face it from", () => {
    const world = worstCaseWorld();
    for (let index = 0; index < COW_HERD; index++) {
      for (const tile of roamTiles(index)) {
        const neighbours = [
          { x: tile.x, y: tile.y - 1 },
          { x: tile.x, y: tile.y + 1 },
          { x: tile.x - 1, y: tile.y },
          { x: tile.x + 1, y: tile.y },
        ].filter((n) => n.x >= 0 && n.y >= 0 && n.x < 30 && n.y < 22);

        expect(
          neighbours.some((n) => !tileBlocked(world, n.x, n.y)),
          `cow #${index} at (${tile.x},${tile.y}) has nowhere to be fed from`,
        ).toBe(true);
      }
    }
  });

  /**
   * The one that makes following the sprite safe at all. Two cows answering on
   * one tile would mean the action key picks whichever `facedAnimal` happened
   * to scan first — you would feed a cow at random.
   *
   * It holds because the roam is VERTICAL and cow slots are 2 tiles apart
   * horizontally, so the columns never meet. Sampled over real wander output
   * rather than reasoned from the config, so a future horizontal roam fails
   * here rather than in someone's barn.
   */
  it("no two cows ever answer on the same tile", () => {
    const { legMs } = WANDER.cow;
    const homes = Array.from({ length: COW_HERD }, (_, i) =>
      pastureSlot("cow", i, 0),
    );
    const seeds = homes.map((_, i) => seedFrom(`cow-${i}`));

    for (let leg = 0; leg < 120; leg++) {
      for (const frac of [0.1, 0.5, 0.95]) {
        const now = leg * legMs + legMs * frac;
        const tiles = homes.map((home, i) =>
          wanderTile(wanderPose("cow", seeds[i]!, home, now)),
        );
        const keys = tiles.map((t) => `${t.tileX},${t.tileY}`);
        expect(
          new Set(keys).size,
          `two cows share a tile at t=${now}: ${keys.join(" ")}`,
        ).toBe(keys.length);
      }
    }
  });
});

/**
 * T-18.05 (BUG-07) — the path the map DRAWS is a path the player can walk.
 *
 * The tests above ask whether the farmer reaches every plot, and it always did
 * — by walking round. Nobody asked the simpler question, so for four phases the
 * y=13 run was severed in three places by the mailbox, the merchant's stall and
 * the shipping box, each placed on it deliberately and each made solid by
 * T-15.05 without anyone revisiting the decision.
 *
 * `collision.test.ts` in shared proves no footing sits on a path tile. This
 * proves the consequence the player actually experiences: drive the real
 * `step()` down each run, through the worst-case world, and arrive.
 */
/**
 * Walk to an arbitrary tile — `walkTo` above only ever targets plots.
 *
 * At module scope, and taking its world, since T-33.03: the villager checks need
 * the same walker and a copy would be a second thing to keep in step with
 * `step`'s signature.
 */
function walkBetweenTiles(
  world: World,
  from: { x: number; y: number },
  to: { x: number; y: number },
  frames = 400,
): { arrived: boolean; state: MoveState } {
  const plan: ReplayPlan = {
    targetId: `${to.x},${to.y}`,
    at: 0,
    kind: "water",
    target: feetOnTile({ tileX: to.x, tileY: to.y }),
    facing: "down",
    travelMs: 0,
    departAt: 0,
  };

  const stepPx = frameDistance(MAX_STEP_MS);
  const start = feetOnTile({ tileX: from.x, tileY: from.y });
  let state = stateAt(start.x, start.y);

  for (let i = 0; i < frames; i++) {
    if (hasArrived(plan, state, stepPx)) return { arrived: true, state };
    state = step(
      state,
      replayInput(plan, state, 1, stepPx),
      MAX_STEP_MS,
      BOUNDS,
      world,
    );
  }

  return { arrived: hasArrived(plan, state, stepPx), state };
}

describe("the drawn path is walkable end to end", () => {
  const world = worstCaseWorld();
  const walkBetween = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    frames = 400,
  ) => walkBetweenTiles(world, from, to, frames);

  it("stands on no blocked tile anywhere", () => {
    const blocked = pathTiles().filter((t) => tileBlocked(world, t.x, t.y));
    expect(
      blocked.map((t) => `(${t.x},${t.y})`),
      "these drawn path tiles are solid — the player walks into thin air",
    ).toEqual([]);
  });

  /**
   * Both directions, because the two ends failed differently: westbound stopped
   * at tile 6 (the stall) and eastbound at tile 13 (the shipping box), and a
   * one-way test would have found only one of them.
   */
  it.each(PATHS.map((run) => [run.join(","), run] as const))(
    "walks the run [%s] from either end",
    (_label, [x0, y0, x1, y1]) => {
      const a = { x: x0, y: y0 };
      const b = { x: x1, y: y1 };

      const there = walkBetween(a, b);
      expect(
        there.arrived,
        `stuck at (${(there.state.x / TILE_SIZE).toFixed(1)},` +
          `${(there.state.y / TILE_SIZE).toFixed(1)}) walking to (${b.x},${b.y})`,
      ).toBe(true);

      const back = walkBetween(b, a);
      expect(
        back.arrived,
        `stuck at (${(back.state.x / TILE_SIZE).toFixed(1)},` +
          `${(back.state.y / TILE_SIZE).toFixed(1)}) walking back to (${a.x},${a.y})`,
      ).toBe(true);
    },
  );

  /**
   * The control, and it is the bug itself: put the shipping box back where it
   * stood before T-18.05 and the eastbound walk must fail. Otherwise "arrived"
   * above might only mean the collider never met anything.
   */
  it("would fail with the shipping box back on the run, which is BUG-07", () => {
    const map = new BlockMap();
    map.set("objects", tileToCells({ x: 14, y: 13 }));
    const severed: World = {
      blocked: map.blocked,
      collider: PLAYER_COLLIDER,
      tileSize: COLLISION_CELL,
    };

    const plan: ReplayPlan = {
      targetId: "east",
      at: 0,
      kind: "water",
      target: feetOnTile({ tileX: 20, tileY: 13 }),
      facing: "down",
      travelMs: 0,
      departAt: 0,
    };
    const stepPx = frameDistance(MAX_STEP_MS);
    const from = feetOnTile({ tileX: 8, tileY: 13 });
    let state = stateAt(from.x, from.y);

    for (let i = 0; i < 400 && !hasArrived(plan, state, stepPx); i++) {
      state = step(
        state,
        replayInput(plan, state, 1, stepPx),
        MAX_STEP_MS,
        BOUNDS,
        severed,
      );
    }

    expect(
      hasArrived(plan, state, stepPx),
      "a crate on the lane must stop the walk",
    ).toBe(false);
    // ...and it is exactly where the crate is, not somewhere else.
    expect(Math.floor(state.x / TILE_SIZE)).toBe(13);
    // The same walk succeeds on the real farm, so the crate is the cause.
    expect(walkBetween({ x: 8, y: 13 }, { x: 20, y: 13 }).arrived).toBe(true);
  });
});

/**
 * Every villager can be stood next to and spoken to (T-33.03).
 *
 * **The failure this guards is specific and permanent.** A villager blocks their
 * own tile, so the only way to talk to one is to stand on an adjacent tile and
 * face them. Place one where all four neighbours are solid — against a building,
 * in the corner of the water border, boxed in by the coop's largest footprint —
 * and the character is unreachable forever, with no in-game way to fix it. It is
 * D-14's coop trap in a different costume, and D-14's answer there (make the
 * thing walk-through) is not available here: a villager you can walk through is
 * a villager you cannot face.
 *
 * Checked against the WORST-CASE world, so a farm that later buys a Deluxe barn
 * cannot wall somebody in retroactively.
 */
describe("every villager is reachable", () => {
  const world = worstCaseWorld();

  /**
   * **The world as it would be if nobody lived here.**
   *
   * A villager's own tile is solid — that is the point of listing them in
   * `objectFootings` — so asking the real world "is this cell free" answers yes
   * for the wrong reason, every time. This is the same map with the villagers
   * left out, which is the only way to ask whether the ground was already taken.
   *
   * Added when break-testing caught the first version passing for a Chef at
   * (0,0): not a building, so `reservedBy` said nothing, and its neighbours were
   * walkable — a villager standing in the sea with two dry cells beside them.
   */
  function worldWithoutVillagers(): World {
    const map = new BlockMap();
    map.set("terrain", tilesToCells(waterTiles()));
    map.set(
      "buildings",
      currentBuildingCells({
        coop: COOP_TIER_ART.length - 1,
        barn: BARN_TIER_ART.length - 1,
      }),
    );
    map.set(
      "objects",
      objectCells(MAP_OBJECTS.map((o) => ({ key: o.key, anchorPx: objectAnchorPx(o.tile) }))),
    );
    return { blocked: map.blocked, collider: PLAYER_COLLIDER, tileSize: COLLISION_CELL };
  }

  const bare = worldWithoutVillagers();

  it.each(VILLAGERS.map((v) => [v.id, v] as const))(
    "the %s is not standing in the sea or inside something",
    (_id, villager) => {
      expect(
        tileBlocked(bare, villager.tile.x, villager.tile.y),
        `${villager.id} at (${villager.tile.x},${villager.tile.y}) stands on ground that is ` +
          "already solid without them — water, a building silhouette, or another " +
          "object's footing",
      ).toBe(false);
    },
  );

  it.each(VILLAGERS.map((v) => [v.id, v] as const))(
    "the %s stands on ground of their own",
    (_id, villager) => {
      // Their own tile is solid — that is the point of listing them in
      // `objectFootings` — but it must be solid because THEY are on it, not
      // because it was already taken by a building or the water.
      expect(
        reservedBy(villager.tile),
        `${villager.id} is inside a building`,
      ).toBeNull();
    },
  );

  it.each(VILLAGERS.map((v) => [v.id, v] as const))(
    "the %s has a free tile to be spoken to from",
    (_id, villager) => {
      const neighbours = [
        { x: villager.tile.x, y: villager.tile.y - 1 },
        { x: villager.tile.x, y: villager.tile.y + 1 },
        { x: villager.tile.x - 1, y: villager.tile.y },
        { x: villager.tile.x + 1, y: villager.tile.y },
      ].filter(
        (t) => t.x >= 0 && t.y >= 0 && t.x < FARM_WIDTH && t.y < FARM_HEIGHT,
      );

      const free = neighbours.filter((t) => !tileBlocked(world, t.x, t.y));
      expect(
        free.map((t) => `(${t.x},${t.y})`),
        `${villager.id} at (${villager.tile.x},${villager.tile.y}) cannot be reached — ` +
          "every neighbouring tile is solid, so nobody can stand where they would " +
          "have to stand to face them",
      ).not.toEqual([]);
    },
  );

  /**
   * Not merely a free neighbour — one you can WALK to. A free tile in a pocket
   * sealed off from the rest of the farm would satisfy the check above and still
   * leave the villager unreachable in practice.
   */
  it.each(VILLAGERS.map((v) => [v.id, v] as const))(
    "the %s can be walked to from the farmhouse door",
    (_id, villager) => {
      const from = { x: HOUSE_ANCHOR.x + 2, y: HOUSE_ANCHOR.y + 2 };
      const neighbours = [
        { x: villager.tile.x, y: villager.tile.y + 1 },
        { x: villager.tile.x - 1, y: villager.tile.y },
        { x: villager.tile.x + 1, y: villager.tile.y },
        { x: villager.tile.x, y: villager.tile.y - 1 },
      ].filter((t) => !tileBlocked(world, t.x, t.y));

      const reached = neighbours.some(
        (t) => walkBetweenTiles(world, from, t).arrived,
      );
      expect(
        reached,
        `no walkable route from the farmhouse to any tile beside the ${villager.id}`,
      ).toBe(true);
    },
  );
});
