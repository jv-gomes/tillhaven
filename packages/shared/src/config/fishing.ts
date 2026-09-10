import { SECOND } from './time.js';

/**
 * How fishing behaves in time (T-34.02).
 *
 * Separate from `fish.ts`, which is the table of WHAT can be caught. This is the
 * clock: how long a fish takes to bite, how long the player has to react, and
 * how long a forgotten cast hangs around.
 *
 * **Every number here is the server's.** The client is told `biteAt` so it can
 * animate, and nothing else — not the seed, not the fish, not the window it is
 * being judged against. A client that knew the window could report a perfect
 * reaction; a client that knew the fish could throw back the ones it did not
 * want (§4.1).
 */

/**
 * How long before something bites, drawn per cast.
 *
 * **A range, not a constant**, because a fixed delay is a metronome: the player
 * stops watching the water and starts counting, and the five-stage animation
 * T-34.05 builds has nothing to say. Two to eight seconds is long enough to
 * feel like waiting and short enough that a cast is not a chore.
 */
export const BITE_MIN_MS = 2 * SECOND;
export const BITE_MAX_MS = 8 * SECOND;

/**
 * How long the player has to reel after the bite.
 *
 * **Generous on purpose.** This is not a reflex test: the game is played on
 * whatever hardware and connection the player has, and a window tight enough to
 * reward a good ping is a window that punishes a bad one. Two seconds is
 * comfortably longer than a round trip and still short enough that walking away
 * loses the fish.
 */
export const REEL_WINDOW_MS = 2 * SECOND;

/**
 * When an unreeled cast stops being reelable at all.
 *
 * Distinct from `REEL_WINDOW_MS` and both are needed: the window is *"you were
 * too slow"*, this is *"that cast is over"*. Without it a player could cast,
 * close the tab, and reel a day later — the fish was rolled at cast time, so a
 * cast left open is a stored reward with no clock on it.
 */
export const CAST_EXPIRY_MS = 60 * SECOND;

/**
 * Whether a reel at `now` lands inside the window for a cast that bit at
 * `biteAt`.
 *
 * Pure, and the whole judgement — the server calls this with its own clock and
 * the client never sends a millisecond. Reeling BEFORE the bite is a miss too:
 * that is striking at nothing, and allowing it would make spamming the reel
 * button strictly better than watching.
 */
export function reelLands(biteAt: number, now: number): boolean {
  return now >= biteAt && now - biteAt <= REEL_WINDOW_MS;
}

/** Whether a cast is too old to be reeled at all. */
export function castExpired(castAt: number, now: number): boolean {
  return now - castAt > CAST_EXPIRY_MS;
}
