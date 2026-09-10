/**
 * Deterministic pseudo-randomness, shared (T-33.06).
 *
 * **Every "random" thing in this game has to be reproducible**, and for two
 * different reasons that happen to want the same tool. The cosmetic case is the
 * animal wander (T-15.12): a chicken's routine must look arbitrary and be
 * identical in every tab, so it is a function of the animal's id and the clock
 * rather than of `Math.random()`. The authoritative case is the quest board: a
 * rotation the player could re-roll by refreshing is a rotation they will
 * refresh until it is generous.
 *
 * These two functions were written for the first case and lived in
 * `apps/client/src/game/animalWander.ts`. They moved here when the second case
 * needed them, rather than being copied — a second FNV-1a that drifted by one
 * constant would produce a client and a server that quietly disagreed about what
 * the same seed means, which is the worst possible shape for this bug.
 */

/**
 * FNV-1a over a string, as an unsigned 32-bit integer.
 *
 * Chosen for being short, well-defined and stable across engines — not for
 * cryptographic strength, which nothing here needs. It must never be used to
 * make anything unguessable; it exists to make things REPRODUCIBLE.
 */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // >>> 0 keeps it an unsigned 32-bit int; Math.imul does the 32-bit multiply
    // without losing the high bits to float precision.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * A deterministic 0..1 from a seed and a counter.
 *
 * Avalanche mix, so consecutive counters give unrelated outputs — a plain
 * `seed + n` would make slot 0 and slot 1 of a quest board correlate, and the
 * board would visibly rhyme.
 */
export function noise(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** A deterministic integer in `[0, count)`. */
export function pick(seed: number, n: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.floor(noise(seed, n) * count));
}
