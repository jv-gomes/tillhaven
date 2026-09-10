import { ITEMS } from '@tillhaven/shared/config';

/**
 * The number that rises off the thing that produced it (T-30.03).
 *
 * Every reward in this game has landed as a DOM toast in the corner since
 * T-18.19 — one place, one cue, and no relationship to where the player was
 * looking. A toast is right for a *refusal*, which is about the rule rather
 * than the tile; it is wrong for a reward, because the player pressed a key at
 * a specific tile and the answer appears somewhere else entirely.
 *
 * **Pure and Phaser-free**, like `effects.ts`'s `BURSTS` beside it and for the
 * same reason: what a float IS — what it says, how far it rises, how long it
 * lasts, what colour — is a set of numbers and one string, all worth asserting
 * without standing up a canvas. `Farm.playFloat` is the handful of lines that
 * hand these to Phaser.
 *
 * Nothing here is authority over anything (§4.1). The server has already
 * decided what happened; this draws a reaction to it, and the values it
 * formats arrive from the server's own response.
 */

/** What a rising label looks like, in the units a Phaser text object takes. */
export interface FloatText {
  readonly text: string;
  /** Hex, in Phaser's `0x` convention. */
  readonly tint: number;
  /** Pixels the label travels upward over its life. */
  readonly risePx: number;
  readonly durationMs: number;
  /**
   * Font size in pixels, BEFORE the scene's zoom. The farm renders at
   * `PIXEL_SCALE`, so these are small numbers on purpose — a 16px label would
   * cover the tile it is describing.
   */
  readonly fontPx: number;
  /**
   * Drawn above the tile's centre by this many pixels, so the label starts
   * clear of the crop sprite rather than on top of it.
   */
  readonly offsetY: number;
}

/** The kinds of thing worth saying at a tile. */
export type FloatKind = 'gold' | 'item' | 'xp';

/**
 * Colours, and the reason they are these colours.
 *
 * Each one matches the HUD element the float is telling you about, so the eye
 * can follow a number from where it was earned to where it is counted: gold
 * floats in the soil tone the gold chip is drawn in, XP in the same green as
 * the level bar's fill (T-30.02), produce in the cream the panels use for
 * ordinary text.
 *
 * **Not sampled from the art**, which is where this differs from `BURSTS`. A
 * burst is debris and belongs to the world; a float is a readout and belongs
 * to the HUD. Tinting it like the tile would make it harder to read, which is
 * the opposite of the point.
 */
export const FLOAT_TINTS: Readonly<Record<FloatKind, number>> = {
  gold: 0xee9d51,
  item: 0xf2e3ce,
  xp: 0x79bf56,
};

/**
 * The base spec per kind.
 *
 * Gold and XP rise further and last longer than produce, because they are the
 * two numbers a player is actually tracking; produce is already visible as an
 * item arriving in the bag.
 */
const BASE: Readonly<Record<FloatKind, Omit<FloatText, 'text' | 'tint'>>> = {
  gold: { risePx: 22, durationMs: 900, fontPx: 10, offsetY: 10 },
  item: { risePx: 18, durationMs: 800, fontPx: 8, offsetY: 6 },
  xp: { risePx: 26, durationMs: 1000, fontPx: 8, offsetY: 14 },
};

/**
 * How a float reads.
 *
 * Always signed, always integer (§10 — gold and quantities are integers
 * everywhere, and a float showing `+1.5g` would be the first place a fraction
 * ever appeared). Item names come from shared config so the float and the bag
 * cannot disagree about what a thing is called.
 */
export function floatTextFor(kind: FloatKind, value: number, itemId?: string): string {
  const n = Math.trunc(value);
  const sign = n < 0 ? '-' : '+';
  const magnitude = Math.abs(n).toLocaleString();

  switch (kind) {
    case 'gold':
      return `${sign}${magnitude}g`;
    case 'xp':
      return `${sign}${magnitude} xp`;
    case 'item':
      return `${sign}${magnitude} ${itemNameFor(itemId)}`;
  }
}

/** The player-facing name of an item, or the raw id tidied up if it is unknown. */
function itemNameFor(itemId: string | undefined): string {
  if (!itemId) return 'item';
  return ITEMS[itemId as keyof typeof ITEMS]?.name ?? itemId.replace(/_/g, ' ');
}

/**
 * The float to draw, or `null` when there is nothing worth saying.
 *
 * **Zero is null, not `+0`.** A harvest that yielded nothing, a sale worth no
 * gold, an action that granted no experience — none of those are events, and a
 * `+0` rising off a tile is noise that teaches the player to stop reading the
 * numbers. The one place this matters in practice is XP: `xpForHarvest`
 * returns 0 for an unknown crop, and the float must not announce it.
 */
export function floatFor(
  kind: FloatKind,
  value: number,
  /*
   * `| undefined` explicitly, because `exactOptionalPropertyTypes` is on:
   * without it a caller cannot forward an `itemId` it holds as
   * `string | undefined` without narrowing first, which every call site would
   * then have to do for no benefit.
   */
  options: {
    readonly itemId?: string | undefined;
    readonly reducedMotion?: boolean | undefined;
  } = {},
): FloatText | null {
  if (!Number.isFinite(value) || Math.trunc(value) === 0) return null;

  const base = BASE[kind];
  const reduced = options.reducedMotion === true;

  return {
    text: floatTextFor(kind, value, options.itemId),
    tint: FLOAT_TINTS[kind],
    /**
     * Reduced motion does not mean *no feedback*, it means no travel. The
     * label still appears, still says the number, and still fades — it simply
     * does not fly. Suppressing it entirely would take information away from
     * the players most likely to need it stated plainly, which is the opposite
     * of what the setting asks for.
     */
    risePx: reduced ? 0 : base.risePx,
    // Slightly longer when it cannot move, since travel is part of how a
    // moving label reads as transient.
    durationMs: reduced ? base.durationMs + 200 : base.durationMs,
    fontPx: base.fontPx,
    offsetY: base.offsetY,
  };
}

/**
 * How long the text object has to stay alive.
 *
 * The same shape as `burstDurationMs`: rounds up, because being too small pops
 * the label out mid-rise while being too large leaves a dead object around a
 * fraction longer.
 */
export function floatLifetimeMs(float: FloatText): number {
  return float.durationMs + 100;
}

/**
 * Vertical spacing when several floats land at once.
 *
 * A harvest produces three at the same tile in the same frame — produce, gold
 * and XP — and drawn at one offset they would be one illegible smear. Each
 * subsequent float starts higher.
 */
export const FLOAT_STACK_PX = 11;

export function stackedOffsetY(float: FloatText, index: number): number {
  return float.offsetY + index * FLOAT_STACK_PX;
}
