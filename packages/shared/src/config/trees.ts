import { HOUR } from './time.js';

/**
 * Trees as a resource (T-20.01, Phase 20).
 *
 * Until now a tree was decoration and `Tree.ts` said so in as many words: *"a
 * tree has no server state, cannot be chopped, and gates nothing."* Chopping
 * changes exactly one thing about that — a tree now has a state the server
 * owns — and this module holds the numbers both sides need to agree on (§4.4).
 *
 * **Where a tree STANDS is still map layout, not economy.** `TREES` in
 * `farmLayout.ts` remains the authority for the five positions, and
 * `MAP_OBJECTS` still bakes them into `farm.json`. This file never restates a
 * coordinate; it answers "what happens when you cut one down".
 */

/**
 * How long a chopped tree takes to grow back.
 *
 * **Chosen against the session shape, not picked round.** `WATER_DURATION_MS`
 * is 4h and is deliberately "longer than a session, come back later"; a tree at
 * 8h is deliberately longer than *that*, so the five trees are a slow trickle
 * rather than a loop you can farm in one sitting.
 *
 * **The faucet this opens is 45 wood a day** — five trees x `WOOD_PER_TREE` x
 * three 8h cycles — and it is stated here because §5.8 says an idle economy
 * dies from unlogged faucets. (The first version of this comment said fifteen;
 * `trees.test.ts` computed it and disagreed, which is the entire reason the
 * number is asserted rather than written down.) T-20.02 must price `wood`
 * against 45/day, not against a guess.
 *
 * Regrowth is computed on read from `choppedAt` (§4.2) — no job, no tick, and
 * offline progress for free, exactly like crop growth.
 */
export const TREE_REGROW_MS = 8 * HOUR;

/**
 * How much wood one tree drops.
 *
 * A flat number rather than a roll. The client would have to be told the result
 * anyway, so randomness here buys nothing but a reconciliation problem — and an
 * idle game's economy is easier to reason about when its faucets are exact
 * (§5.8: "an idle economy dies from unlogged faucets").
 */
export const WOOD_PER_TREE = 3;

/** A tree as the client is allowed to see it. */
export interface TreeView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** False while the stump is regrowing. */
  readonly isStanding: boolean;
  /** ms until it grows back; 0 when it is already standing. */
  readonly regrowsInMs: number;
}

/**
 * Whether a tree is standing right now, and how long until it is.
 *
 * Pure, with `now` a parameter, for the same reason every other time
 * calculation here takes one: a test cannot be deterministic against
 * `Date.now()`. Shared so the server computes the authoritative answer and the
 * client can count the same clock down between polls without inventing one.
 *
 * `choppedAt` of `null` means never chopped — a tree that has always stood.
 */
export function treeStateAt(
  choppedAt: number | null,
  now: number,
): { readonly isStanding: boolean; readonly regrowsInMs: number } {
  if (choppedAt === null) return { isStanding: true, regrowsInMs: 0 };

  const regrowsAt = choppedAt + TREE_REGROW_MS;
  if (now >= regrowsAt) return { isStanding: true, regrowsInMs: 0 };

  return { isStanding: false, regrowsInMs: regrowsAt - now };
}
