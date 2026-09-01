import argon2 from 'argon2';

/**
 * The only module in the codebase that imports argon2 (CLAUDE.md §8).
 *
 * Nothing here ever logs, returns, or throws a value derived from the
 * plaintext — an argon2 failure is reported as "did not verify", never as an
 * error carrying the input.
 */

/**
 * argon2**id**, not argon2i or argon2d. id is the hybrid recommended by RFC 9106
 * for password hashing: side-channel resistance from i, GPU resistance from d.
 *
 * Cost parameters are above the RFC's second recommended profile. They are
 * pinned here rather than left to argon2's defaults so that a library upgrade
 * cannot silently weaken hashing. Raising them is safe at any time: the
 * parameters are encoded in each stored hash, so old hashes keep verifying and
 * can be re-hashed on next successful login.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  // argon2 generates a fresh random salt per call and embeds it in the output,
  // so the same password never produces the same hash twice.
  return argon2.hash(plain, OPTIONS);
}

/**
 * Returns false for a wrong password AND for a stored hash that is empty,
 * truncated, or otherwise unparseable.
 *
 * Throwing on a malformed hash would turn one corrupt row into a 500 that
 * distinguishes it from an ordinary failed login — an oracle telling an
 * attacker which accounts have damaged credentials.
 */
export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  if (!storedHash || !plain) return false;

  try {
    return await argon2.verify(storedHash, plain);
  } catch {
    return false;
  }
}

/**
 * True when a stored hash was made with weaker parameters than we now use, so
 * the caller can transparently re-hash during a successful login.
 *
 * Only ever called with a hash that has just verified — never on a failed
 * login, where the timing of the extra work would be observable.
 */
export function needsRehash(storedHash: string): boolean {
  try {
    return argon2.needsRehash(storedHash, OPTIONS);
  } catch {
    // Unparseable means it cannot be trusted; treat it as needing replacement.
    return true;
  }
}
