import { CROPS, ITEMS, SOIL_DRY_FRAMES, SOIL_WET_FRAMES } from '@tillhaven/shared/config';
import type { PlotView } from '@tillhaven/shared/types';

/**
 * What a plot should look like right now, and what a plot will *probably* look
 * like after an intent the server has not answered yet.
 *
 * Pure, and `now` is always a parameter — same rule as the server's growth
 * calculation, for the same reason: a test cannot be deterministic against
 * `Date.now()`.
 *
 * Nothing here is authoritative. These functions decide **pixels**, never
 * items: they never grant produce, move gold or touch a bag slot, and every
 * answer is replaced by the next `GET /api/farm` (CLAUDE.md §4.1).
 *
 * **No predictions live here any more.** T-9.06 dropped `predictPlant` and
 * `predictHarvest` along with click-to-act: the tool swing now covers the round
 * trip, and four intents would have meant four guesses at soil, wetness, growth
 * and produce — four chances to draw something the server then contradicts.
 * Interpolating between polls is the one kind of guessing left, and it only
 * ever moves a countdown that is already running.
 *
 * **Growth v2 (D-1).** A crop advances only while its soil is wet, so
 * interpolation counts down watered time, not wall-clock time: a plot whose
 * window lapses between two polls stops moving on screen at the instant it
 * dries, without waiting to be told. `view.wetUntil` is an absolute
 * server-clock instant, which is what makes that possible locally.
 */

/** What to draw under a plot. `untilled` shows the map's own ground. */
export type SoilState = 'untilled' | 'dry' | 'wet';

export interface PlotDisplay {
  /** Index into the crop's `stageFrames`. */
  readonly stage: number;
  readonly isRipe: boolean;
  /** ms of WATERED time still needed; 0 once ripe. */
  readonly readyInMs: number;
  /** True when the countdown is stopped because the soil is dry. */
  readonly isPaused: boolean;
  readonly soil: SoilState;
}

/**
 * The soil under a plot, derived from `wetUntil` rather than from `isWet`.
 *
 * `isWet` is the server's answer at the `serverNow` of the poll it came in
 * with, and would leave a plot looking wet for up to a poll interval after its
 * window actually closed. The absolute instant answers the same question at
 * any `now`, so wetness expires on screen exactly when it expires in the model.
 */
export function soilAt(view: PlotView, now: number): SoilState {
  if (!view.tilled) return 'untilled';
  if (view.wetUntil !== null && now < view.wetUntil) return 'wet';
  return 'dry';
}

/**
 * The plot as it should be drawn, interpolated forward from the moment the
 * view was measured.
 *
 * `viewAt` is that moment on the SERVER's clock — the `serverNow` of the poll
 * the view arrived in, or the local server-time estimate for a prediction made
 * between polls. Every field on a view is relative to it, so passing it in
 * (rather than resolving to an absolute ripening instant, which v1 did) is what
 * lets this account for a window that closes part way through the interval.
 *
 * A plot may be drawn ripe on the strength of the local clock — that is what
 * makes the countdown smooth — but drawing it ripe grants nothing. The harvest
 * intent still goes to the server and the server can still say no.
 */
export function displayAt(view: PlotView, viewAt: number, now: number): PlotDisplay {
  const soil = soilAt(view, now);

  if (view.cropId === null || view.plantedAt === null || view.effectiveDurationMs <= 0) {
    return { stage: 0, isRipe: false, readyInMs: 0, isPaused: false, soil };
  }

  const stages = CROPS[view.cropId].stageFrames.length;
  const lastStage = stages - 1;
  const ripe: PlotDisplay = {
    stage: lastStage,
    isRipe: true,
    readyInMs: 0,
    // A finished crop is never "paused" — it is done, whatever its soil is
    // doing. Same rule as the server's growth.ts.
    isPaused: false,
    soil,
  };
  if (view.isRipe) return ripe;

  /*
   * Watered time elapsed since the view was measured: the interval between
   * `viewAt` and `now`, truncated at the moment the wet window closes. A plot
   * that was already dry contributes zero, which is precisely "paused".
   */
  const grewUntil = view.wetUntil === null ? viewAt : Math.min(now, view.wetUntil);
  const grown = Math.max(0, grewUntil - viewAt);
  const readyInMs = Math.max(0, view.readyInMs - grown);
  if (readyInMs === 0) return ripe;

  /*
   * The server's own stage formula (growth.ts), against the duration it sent —
   * not an inference from `plantedAt`, which stopped meaning anything when
   * growth stopped being wall-clock time.
   */
  const elapsed = view.effectiveDurationMs - readyInMs;
  const progressed = Math.floor((elapsed * stages) / view.effectiveDurationMs);
  const stage = Math.min(lastStage, Math.max(0, progressed));

  return { stage, isRipe: false, readyInMs, isPaused: soil !== 'wet', soil };
}

/* ------------------------------------------------------------------ *
 * Soil edges (T-19.01)
 * ------------------------------------------------------------------ */

/**
 * A tile's identity in the sets below. The one place the format is written.
 *
 * `Farm.ts` had its own copy of this and now imports this one: the tilled set
 * it builds is consumed by `soilMaskAt`, so two spellings of a tile key would
 * be two spellings that silently have to agree.
 */
export function tileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

/** Neighbour bits. Mirrors `scripts/draw-ground-tiles.py`, which draws them. */
export const SOIL_N = 1;
export const SOIL_E = 2;
export const SOIL_S = 4;
export const SOIL_W = 8;

/**
 * Which of a tile's four neighbours are also tilled, as a 4-bit mask.
 *
 * This is the whole reason tilled soil has a boundary. A flat fill has no
 * edges, so a hoed plot was a bare terracotta square butted against grass, and
 * **The pack does supply the edges, and that is new.** This comment used to say
 * `TILESET_SOIL` was *"rounded clod stamps with dark outline pixels along every
 * cell edge"* and could not be tiled — measured on the incomplete pack. The
 * complete one has a full 4x4 wang set for dry soil and another for wet, all
 * sixteen masks present, so the sixteen generated frames are gone and the mask
 * indexes `SOIL_DRY_FRAMES` / `SOIL_WET_FRAMES` into `TILESET_SOIL` itself.
 *
 * Sixteen masks rather than a 9-role nine-slice, still: a nine-slice has no art
 * for an isolated tile or a 1-wide strip, and the first plot anyone tills is
 * isolated.
 *
 * **The set must contain only UNLOCKED, tilled plots.** A locked plot is not
 * tilled and must read as absent, or a locked neighbour would suppress the rim
 * on the edge facing it and the field would bleed into ground that is not
 * yours.
 *
 * Diagonals are deliberately not consulted: an inner corner needs its own art
 * to be worth detecting, and this sheet — being edge-rimmed rather than
 * nine-sliced — has nowhere to put it.
 */
export function soilMaskAt(tilled: ReadonlySet<string>, tileX: number, tileY: number): number {
  let mask = 0;
  if (tilled.has(tileKey(tileX, tileY - 1))) mask |= SOIL_N;
  if (tilled.has(tileKey(tileX + 1, tileY))) mask |= SOIL_E;
  if (tilled.has(tileKey(tileX, tileY + 1))) mask |= SOIL_S;
  if (tilled.has(tileKey(tileX - 1, tileY))) mask |= SOIL_W;
  return mask;
}

/**
 * The frame of `TILESET_SOIL` to draw, by mask and wetness.
 *
 * **The mask is over "is tilled", never "is tilled and equally wet".** A
 * watered plot in the middle of a dry field is therefore a colour change with
 * no rim around it — the soil is continuous, the wetness is not — which keeps
 * the dryness signal (T-18.16) readable without chopping the field into
 * fenced-off patches every time one plot's window lapses.
 *
 * `untilled` has no frame at all; the caller hides the image and the map's own
 * ground shows through — which since the re-scope is the ORANGE tillable fill,
 * so an un-hoed plot still reads as a field.
 *
 * Returns a frame NUMBER now, not a name. The frames used to be cropped out of
 * a generated image at runtime (`registerSoilFrames`, deleted); they are now
 * ordinary spritesheet frames of `TILESET_SOIL`, which Phaser slices on load.
 */
export function soilFrame(mask: number, soil: SoilState): number | null {
  if (soil === 'untilled') return null;
  const frames = soil === 'wet' ? SOIL_WET_FRAMES : SOIL_DRY_FRAMES;
  return frames[mask] ?? null;
}

/* ------------------------------------------------------------------ *
 * Thirst (T-18.16, F-2)
 * ------------------------------------------------------------------ */

/**
 * The icon to float over a plot, or `null` when it wants nothing.
 *
 * **Watering was invisible as a requirement.** D-1 decided a crop only grows
 * while its soil is wet — so a plot left dry sits at the same stage forever —
 * and the only signal the game gave was the hover countdown reading `DRY · …`.
 * A player who does not hover never learns why nothing grows, which for the
 * central mechanic of the farming loop is close to the worst possible outcome:
 * the game looks broken and the fix is one keypress away.
 *
 * The soil tone already changes (`drawSoil`), and it is not enough on its own:
 * a planted tile is mostly covered by its crop sprite, so the difference
 * between wet and dry soil is a few pixels around the edge of the thing you are
 * looking at.
 *
 * **It shows the watering can**, deliberately, rather than a droplet or a
 * warning triangle. The badge's job is not "something is wrong here" — the
 * player can see the crop is not growing — it is "bring THIS", and the icon it
 * shows is the one sitting in their hotbar.
 *
 * Mirrors `badgeFor` in `animalSprites.ts` on purpose: same shape, same
 * reasoning, and a plot that needs attention should announce it the way an
 * animal already does.
 */
export const THIRSTY_ITEM_ID = 'watering_can_wood';

export function plotBadgeFor(display: PlotDisplay): { sheet: string; frame: number } | null {
  // `isPaused` is already exactly this question: planted, not ripe, soil dry.
  // Asked through the display rather than the view so it agrees with what is
  // drawn, including the client's own interpolation past the last poll.
  if (!display.isPaused) return null;

  const icon = ITEMS[THIRSTY_ITEM_ID]?.icon;
  return icon ? { sheet: icon.sheet, frame: icon.frame } : null;
}

/**
 * How many unlocked plots are sitting dry with a crop in them.
 *
 * For the HUD, which is the half of F-2 the badge cannot do: a badge tells you
 * about a plot you are looking at, and the farm is thirty tiles wide. The count
 * is what tells a player who has just come back that there is something to do
 * at all.
 */
export function thirstyCount(views: readonly PlotView[], viewAt: number, now: number): number {
  let n = 0;
  for (const view of views) {
    if (displayAt(view, viewAt, now).isPaused) n += 1;
  }
  return n;
}
