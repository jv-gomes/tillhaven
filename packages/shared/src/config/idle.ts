import { SECOND } from './time.js';

/**
 * Idle mode — the headline feature (CLAUDE.md §5.3, Phase 13).
 *
 * The player flips a switch, picks which chores the farmer should do and which
 * crop to plant, and the farmer works on its own. Nothing here runs a loop:
 * idle work is **derived from timestamps** exactly like crop growth is (§4.2).
 * The server keeps a watermark (`farms.idle_processed_at`), and on the next
 * read it works out how many actions fit between that watermark and now,
 * replays them through a pure simulator, and applies the result in one
 * transaction. That is what makes the farm keep working with the tab closed,
 * and it is why there are no scheduled jobs in this file's future.
 *
 * Read by the client for DISPLAY ONLY and by the server for AUTHORITATIVE
 * calculation — they must never diverge (§4.4).
 */

/**
 * The chores a farmer can be told to do.
 *
 * Deliberately the four verbs of the farming loop (§5.2) and nothing else. The
 * list is designed to GROW — chopping and mining are the obvious next two, and
 * they are next precisely because adding one should be a new entry here plus a
 * branch in the simulator, not a new shape of feature.
 *
 * The order is the order the simulator considers them in, which is the order a
 * person would: you cannot plant ground you have not tilled, or water a seed
 * you have not planted. It is not a priority the player sets — one fixed,
 * legible order beats a configurable one nobody can predict the result of.
 */
export const IdleTask = {
  TILL: 'till',
  PLANT: 'plant',
  WATER: 'water',
  HARVEST: 'harvest',
  /*
   * Chopping (T-20.06), and the first idle task that does not address a plot.
   *
   * §5.3 always said this list was "designed to grow into chop/mine later", and
   * this is the growth — but it is not quite the "one more branch" the comment
   * above promises: a tree is a different entity with a different clock, so the
   * simulator carries trees alongside plots and `SimAction` gained a `treeId`.
   * Mining would now be genuinely one more branch; this one paid to widen the
   * road.
   */
  CHOP: 'chop',

  /*
   * **Fishing is deliberately NOT here** (T-34.08), and this is where the
   * decision lives because this is where somebody would add it.
   *
   * §1's pillar is that progress continues while the player is away; the
   * gameplay overhaul's premise is that **active play is where depth lives**.
   * Idle mode runs the farm LOOP — the four verbs that are the same work every
   * time, plus chopping, which is a timer with an axe attached. Fishing is the
   * first mechanic in this game that rewards *attention*: the bite is drawn per
   * cast and the reel is judged against a two-second window. An idle farmer
   * fishing would either miss every cast (pointless) or land every one
   * (the minigame deleted, and the best income in the game handed to the tab
   * nobody is looking at).
   *
   * `idle.test.ts` asserts this rather than a comment doing it, which is the
   * point: adding `FISH: 'fish'` above would be a one-line change that reads as
   * an obvious omission being fixed, and it must instead fail a test with the
   * reason attached.
   */
} as const;
export type IdleTask = (typeof IdleTask)[keyof typeof IdleTask];

export const IDLE_TASK_TYPES = Object.values(IdleTask) as readonly IdleTask[];

export function isIdleTask(value: string): value is IdleTask {
  return (IDLE_TASK_TYPES as readonly string[]).includes(value);
}

/**
 * How long one idle action takes — walking to it included.
 *
 * Ten seconds is a deliberate tax on not playing, not a physics number: a
 * present player with a hoe can till a plot in about a second, so idling is
 * roughly a tenth the speed of doing it yourself. That is the whole balance
 * lever for the feature, which is why it is one constant rather than a
 * per-task table — per-task times would let a player game the mix, and the
 * walking is most of the time anyway.
 */
export const IDLE_ACTION_MS = 10 * SECOND;

/**
 * The most actions one catch-up may replay, however long the player was away.
 *
 * A cap is required, not a nicety. Without it a farm untouched for a year
 * asks the simulator for three million steps inside a request that has a
 * transaction open — the read that was supposed to be O(1) becomes the slowest
 * thing in the game, on the hottest path (§11). 5,000 actions is ~14 hours of
 * idling at `IDLE_ACTION_MS`, comfortably past a night's sleep, which is the
 * absence this feature is actually for.
 *
 * Exceeding it is NOT an error and never loses a player anything they earned:
 * the applier advances the watermark by the actions it did run, so the
 * remainder is simply picked up by the next read. A player back from two weeks
 * away catches up over a few polls instead of one long one.
 */
export const IDLE_MAX_CATCHUP_ACTIONS = 5_000;

/** The longest stretch a single catch-up can cover, derived not written down. */
export const IDLE_MAX_CATCHUP_MS = IDLE_MAX_CATCHUP_ACTIONS * IDLE_ACTION_MS;

/**
 * How many actions fit in a window — the whole of the time model, in one place.
 *
 * Floor, not round: an action that has not finished has not happened. Clamped
 * at both ends, so a clock that goes backwards (a watermark ahead of `now`,
 * which a server clock adjustment can produce) yields 0 rather than a negative
 * count that would run the simulator in reverse.
 */
export function idleActionsIn(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.min(Math.floor(elapsedMs / IDLE_ACTION_MS), IDLE_MAX_CATCHUP_ACTIONS);
}
