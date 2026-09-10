import { MINUTE } from './time.js';
import { MAX_FARM_LEVEL } from './level.js';

/**
 * Energy — what a farmer can do before they have to sleep (MVP re-scope).
 *
 * **The first hard limit on ACTION the game has had.** Until now the only
 * thing standing between a player and more farming was a growth timer: you
 * could till, plant and water every plot you owned the moment you owned it,
 * and the wait was for the crop rather than for you. Energy makes the doing
 * itself finite, which is what turns "I have twenty plots" into a decision
 * about which ones to work today.
 *
 * **Derived from timestamps, never ticked** (CLAUDE.md §4.2), exactly like
 * crop growth and shipping payouts. The database stores how much has been
 * SPENT and when sleep began; how much is left is arithmetic done on read.
 * Nothing here runs on a schedule and no job restores anyone's energy.
 *
 * **Nothing in this file is authority.** The server computes the same numbers
 * from the same config and refuses an action it cannot pay for (§4.1); the
 * client reads them only to draw a bar and grey out a tool.
 */

/* ------------------------------------------------------------------ *
 * The cap
 * ------------------------------------------------------------------ */

/**
 * What a level-1 farmer can do in a day.
 *
 * Sized against the opening rather than picked round: tilling, planting and
 * watering all six starting plots costs `6 x (2 + 2 + 2) = 36`, so a new
 * player can just about work their whole farm once and has four points left
 * over. That is the brief's *"at the start the player cannot do very much"*
 * expressed as a number — the first session is one full pass, not three.
 */
export const ENERGY_BASE = 40 as const;

/**
 * Added to the cap every `ENERGY_LEVELS_PER_STEP` levels.
 *
 * Deliberately small. Energy is a limit, and a limit that dissolves as you
 * level stops being one — at the level cap this is +20 on 40, so a farm at
 * level 30 works half again as much per day as a new one, not ten times as
 * much. Plot expansion, not energy, is what makes a big farm big.
 */
export const ENERGY_PER_STEP = 10 as const;

/** How many levels between cap increases. "A little every ten levels." */
export const ENERGY_LEVELS_PER_STEP = 10 as const;

/**
 * The energy cap for a farm level.
 *
 * Level 1-10 gets the base, 11-20 one step, 21-30 two. Integer throughout
 * (§10) and monotonic: more levels never means less energy.
 */
export function energyCapForLevel(level: number): number {
  if (!Number.isFinite(level) || level < 1) return ENERGY_BASE;

  const capped = Math.min(Math.floor(level), MAX_FARM_LEVEL);
  const steps = Math.floor((capped - 1) / ENERGY_LEVELS_PER_STEP);
  return ENERGY_BASE + steps * ENERGY_PER_STEP;
}

/* ------------------------------------------------------------------ *
 * What things cost
 * ------------------------------------------------------------------ */

/**
 * Every action that spends energy, and what it spends.
 *
 * **Harvesting is the cheapest thing on the list, and that is deliberate.**
 * The other four are work you choose to start; a harvest is collecting on work
 * already done, and a player who cannot afford to pick a ripe crop is being
 * punished for having farmed well. The same argument makes collecting from an
 * animal cheap.
 *
 * **Chopping is the dearest.** It is the only action with no growth timer
 * behind it — five trees regrow on their own schedule and a player could
 * otherwise spend an entire session doing nothing else.
 *
 * A `Record` rather than a field on each action so the whole cost table is one
 * thing to read, argue with and re-balance.
 */
export const EnergyAction = {
  TILL: 'till',
  PLANT: 'plant',
  WATER: 'water',
  HARVEST: 'harvest',
  CHOP: 'chop',
  COLLECT: 'collect',
  FEED: 'feed',
  CAST: 'cast',
} as const;
export type EnergyAction = (typeof EnergyAction)[keyof typeof EnergyAction];

export const ENERGY_COST: Readonly<Record<EnergyAction, number>> = {
  [EnergyAction.TILL]: 2,
  [EnergyAction.PLANT]: 2,
  [EnergyAction.WATER]: 2,
  [EnergyAction.HARVEST]: 1,
  [EnergyAction.CHOP]: 4,
  [EnergyAction.COLLECT]: 1,
  [EnergyAction.FEED]: 1,
  /*
   * **Casting is dear, and energy is what makes fishing bot-proof** (T-34.02).
   *
   * Fishing was designed before energy existed. It is the only action that pays
   * gold for a fixed, short wait with no growth timer behind it, so a rate limit
   * alone would leave a bot casting at the limit all day — the same argument
   * that makes chopping the dearest thing on this list, only sharper, because a
   * tree at least has to regrow.
   *
   * At 3 a cast, a full 40-energy bar is 13 casts, which at T-34.01's 32-71g
   * expected value is 416-923g of fishing between sleeps. That is a session's
   * worth of an alternative income, not a replacement for the farm — and a bot
   * casting flat out hits the same wall a person does, which is what
   * "gains nothing over a person" actually requires.
   */
  [EnergyAction.CAST]: 3,
};

export function energyCostOf(action: EnergyAction): number {
  return ENERGY_COST[action];
}

/* ------------------------------------------------------------------ *
 * Sleep
 * ------------------------------------------------------------------ */

/**
 * Ten real minutes in bed restores a full bar.
 *
 * **Real minutes, not game hours.** The day/night cycle is cosmetic in this
 * MVP, so tying recovery to it would mean a player who logs in at the wrong
 * time cannot recover at all. Ten minutes is long enough that sleeping is a
 * decision — it is roughly the parsnip cycle, so the choice is "rest or plant
 * another round" — and short enough to fit inside the short, frequent sessions
 * §1 asks for.
 */
export const SLEEP_DURATION_MS = 10 * MINUTE;

/**
 * How much of the bar `elapsed` in bed gives back.
 *
 * **Proportional, not all-or-nothing.** Waking after four minutes returns 40%
 * rather than nothing: an all-or-nothing rule would punish a player who came
 * back early, and "you slept but gained nothing" is the kind of rule people
 * remember as a bug. It also means the value is a pure function of two
 * timestamps, so nothing has to fire at the ten-minute mark.
 *
 * Rounded DOWN, so a player never gains a point they have not fully slept for.
 */
export function energyRecovered(elapsedMs: number, cap: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const fraction = Math.min(1, elapsedMs / SLEEP_DURATION_MS);
  return Math.floor(cap * fraction);
}

/* ------------------------------------------------------------------ *
 * The whole state, derived
 * ------------------------------------------------------------------ */

/** What the database stores. Everything else is computed from it. */
export interface EnergyRow {
  /** Lifetime-of-this-rest energy spent. Reset by sleeping. */
  readonly energySpent: number;
  /** When the player lay down, or null if they are awake. Epoch ms. */
  readonly sleepingSince: number | null;
}

export interface EnergyState {
  readonly current: number;
  readonly max: number;
  readonly isSleeping: boolean;
  /** Milliseconds until a full bar, or 0 when awake or already full. */
  readonly fullInMs: number;
}

/**
 * A player's energy right now.
 *
 * **Sleep settles on read**, the same shape as a shipping payout: there is no
 * job that wakes anyone up, so the value of "how much energy do I have" simply
 * accounts for however long the player has been in bed. A sleeping player's
 * bar therefore fills smoothly on the client between polls without the server
 * having done anything.
 */
export function energyStateAt(row: EnergyRow, level: number, now: number): EnergyState {
  const max = energyCapForLevel(level);
  const spent = Math.max(0, Math.min(max, Math.floor(row.energySpent)));

  if (row.sleepingSince === null) {
    return { current: max - spent, max, isSleeping: false, fullInMs: 0 };
  }

  const elapsed = Math.max(0, now - row.sleepingSince);
  const current = Math.min(max, max - spent + energyRecovered(elapsed, max));
  const remaining = Math.max(0, SLEEP_DURATION_MS - elapsed);

  return {
    current,
    max,
    isSleeping: true,
    fullInMs: current >= max ? 0 : remaining,
  };
}

/**
 * `energySpent` after waking, so the recovery is banked rather than recomputed
 * forever from a timestamp that is about to be cleared.
 */
export function energySpentAfterSleep(row: EnergyRow, level: number, now: number): number {
  const state = energyStateAt(row, level, now);
  return Math.max(0, state.max - state.current);
}
