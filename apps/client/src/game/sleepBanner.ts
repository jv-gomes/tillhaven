import type { EnergyState } from '@tillhaven/shared/config';

/**
 * What the sleeping banner says, and when (MVP re-scope).
 *
 * **Pulled out of the HUD so it can be tested at all.** `hud.ts` builds DOM and
 * these tests have no DOM, but nothing interesting here needs one: the banner
 * is a deadline and a sentence, and both are arithmetic.
 *
 * **The deadline is computed once, then counted down locally.** Energy recovery
 * is a pure function of elapsed time server-side (`energyStateAt`), so a
 * ticking client and a silent server cannot disagree — polling once a second
 * for a number that subtraction already knows would be a request per second
 * per sleeping player, for nothing.
 */

/**
 * When the bar will be full, as a wall-clock instant.
 *
 * `fullInMs` is a duration measured at the moment the server answered, so it is
 * only correct at that moment; an instant stays correct as the second hand
 * moves. Returns `now` for a player who is awake or already rested — the caller
 * has nothing to count down either way.
 */
export function restedAt(energy: EnergyState, now: number): number {
  if (!energy.isSleeping) return now;
  return now + Math.max(0, energy.fullInMs);
}

/**
 * The banner's line.
 *
 * **Rounded up, so the last second is shown rather than skipped.** A countdown
 * that reads "0s" while still counting is the kind of small lie that makes
 * players think the game has hung; `ceil` means it reads "1s" until the moment
 * it is actually done.
 *
 * The rested line does not say "you may now get up", because the player could
 * always get up — waking early has always been worth its fraction. It says the
 * waiting is over.
 */
export function sleepLabel(msLeft: number): string {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return 'Fully rested — get up whenever.';
  return `Sleeping — rested in ${Math.ceil(msLeft / 1000)}s`;
}
