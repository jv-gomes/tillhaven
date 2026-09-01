import { and, eq, sql } from 'drizzle-orm';
import {
  ErrorCode,
  GameError,
  MAX_PLOTS,
  PLOT_POSITIONS,
  VIP_BENEFITS,
  plotUnlockCost,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Queryable, Tx } from '../../db/tx.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { isVip } from '../player/view.js';

/**
 * Plot expansion (CLAUDE.md §5.6) — the largest gold sink in the game.
 *
 * Every plot a farm will ever have already exists as a row from registration;
 * expansion flips `unlocked`. That keeps a plot's identity stable and makes this
 * a one-row update rather than an insert that has to invent a position.
 *
 * **Price comes from the plot's place in the unlock order, not from the
 * request.** Each authored plot marker carries an `index` property that
 * `pnpm plots` bakes into `PLOT_POSITIONS`, and `plotUnlockCost(index)` prices
 * it. The client sends a plot id and nothing else (§4.1).
 *
 * Order is deliberately NOT enforced. Buying the twentieth plot before the
 * seventh is allowed and simply costs what the twentieth costs — the price
 * follows the plot, so there is nothing to exploit, and forbidding it would be
 * a rule with no purpose behind it.
 */

export interface UnlockResult {
  readonly plotId: string;
  readonly x: number;
  readonly y: number;
  readonly cost: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
  /** Unlocked plots after this one, and the most this player may ever have. */
  readonly unlockedPlots: number;
  readonly plotCap: number;
}

/**
 * How many plots this player may unlock.
 *
 * **Clamped to the number of authored positions**, and that clamp is currently
 * load-bearing: `VIP_BENEFITS.bonusPlotSlots` grants four plots on top of
 * `MAX_PLOTS`, but the map only marks `MAX_PLOTS` cells, so there is no
 * twenty-first plot for a VIP to stand on. Every plot must sit on soil someone
 * painted, so the fix is to mark more cells in `apps/mapmaker` and re-run
 * `pnpm plots` — not to invent a coordinate here.
 *
 * Nothing is broken today: VIP cannot be bought until Phase 5. **T-5.06 must
 * author those cells**, or the bonus it advertises will silently do nothing.
 * A test pins this so the day the map gains cells, the behaviour changes.
 */
export function plotCapFor(player: AuthedPlayer, now: number): number {
  const withVip = MAX_PLOTS + (isVip(player, now) ? VIP_BENEFITS.bonusPlotSlots : 0);
  return Math.min(withVip, PLOT_POSITIONS.length);
}

/** The plot's position in the unlock order, or -1 if the map no longer has it. */
export function unlockIndexOf(x: number, y: number): number {
  return PLOT_POSITIONS.findIndex((p) => p.x === x && p.y === y);
}

/** Cost of every plot this player could still buy, cheapest first. */
export async function expansionPrices(
  q: Queryable,
  player: AuthedPlayer,
  now: number,
): Promise<{ plotId: string; cost: number; index: number }[]> {
  const rows = await q
    .select({ id: schema.plots.id, x: schema.plots.x, y: schema.plots.y })
    .from(schema.plots)
    .innerJoin(schema.farms, eq(schema.plots.farmId, schema.farms.id))
    .where(and(eq(schema.farms.playerId, player.id), eq(schema.plots.unlocked, false)));

  const cap = plotCapFor(player, now);

  return rows
    .map((row) => ({ plotId: row.id, index: unlockIndexOf(row.x, row.y) }))
    .filter((row) => row.index >= 0 && row.index < cap)
    .map((row) => ({ ...row, cost: plotUnlockCost(row.index) }))
    .sort((a, b) => a.cost - b.cost);
}

/**
 * Buys one locked plot.
 *
 * Gold leaves and the plot opens in one transaction. The player row is locked
 * first, in the same order as every other purchase in the game, so two clicks
 * on the same plot cannot both read it as locked and both charge for it.
 */
export async function unlockPlot(
  tx: Tx,
  player: AuthedPlayer,
  plotId: string,
  now: number,
): Promise<UnlockResult> {
  const goldRows = await tx
    .select({ gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, player.id))
    .limit(1)
    .for('update');

  const gold = goldRows[0]?.gold;
  if (gold === undefined) throw new GameError(ErrorCode.NOT_FOUND, 'No such player.');

  const plotRows = await tx
    .select({ plot: schema.plots, farmPlayerId: schema.farms.playerId })
    .from(schema.plots)
    .innerJoin(schema.farms, eq(schema.plots.farmId, schema.farms.id))
    .where(eq(schema.plots.id, plotId))
    .limit(1)
    .for('update', { of: schema.plots });

  const row = plotRows[0];
  // Someone else's plot and a plot that does not exist give the same answer.
  if (!row || row.farmPlayerId !== player.id) {
    throw new GameError(ErrorCode.NOT_FOUND, 'That plot is not on your farm.');
  }

  const plot = row.plot;
  if (plot.unlocked) {
    throw new GameError(ErrorCode.PLOT_ALREADY_UNLOCKED, 'That plot is already cleared.');
  }

  const index = unlockIndexOf(plot.x, plot.y);
  if (index < 0) {
    // The map no longer marks this cell. Refusing beats guessing a price.
    throw new GameError(ErrorCode.NOT_FOUND, 'That plot is no longer part of the farm.');
  }

  const cap = plotCapFor(player, now);
  if (index >= cap) {
    throw new GameError(ErrorCode.PLOT_CAP_REACHED, 'Your farm cannot grow any further.', {
      cap,
    });
  }

  const cost = plotUnlockCost(index);
  if (gold < cost) {
    throw new GameError(ErrorCode.INSUFFICIENT_GOLD, "You can't afford that.", {
      needed: cost,
      held: gold,
    });
  }

  await tx.update(schema.plots).set({ unlocked: true }).where(eq(schema.plots.id, plot.id));

  await tx
    .update(schema.players)
    .set({ gold: sql`${schema.players.gold} - ${cost}` })
    .where(eq(schema.players.id, player.id));

  const unlockedRows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.plots)
    .innerJoin(schema.farms, eq(schema.plots.farmId, schema.farms.id))
    .where(and(eq(schema.farms.playerId, player.id), eq(schema.plots.unlocked, true)));

  return {
    plotId: plot.id,
    x: plot.x,
    y: plot.y,
    cost,
    goldDelta: -cost,
    goldAfter: gold - cost,
    unlockedPlots: unlockedRows[0]?.count ?? 0,
    plotCap: cap,
  };
}
