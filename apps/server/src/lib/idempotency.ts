import { and, eq } from 'drizzle-orm';
import { GameError, ErrorCode } from '@tillhaven/shared';
import { db, schema } from '../db/client.js';
import { isUniqueViolation, type Tx } from '../db/tx.js';

/**
 * Idempotency for state-changing endpoints (CLAUDE.md §4.5).
 *
 * Double-submitting `harvest` because of a flaky connection must not yield
 * double rewards. The client generates one key per user action and reuses it
 * across retries of that action.
 *
 * How it works: the key row is inserted FIRST, inside the same transaction as
 * the work. The unique index on (player_id, key) is what actually serialises
 * concurrent duplicates — a second request blocks on that index until the first
 * commits, then fails, then reads back the first request's stored response.
 *
 * A pre-flight "has this key been used?" SELECT could not do this. Two requests
 * would both pass it.
 */

/** Marks a row whose work has not finished yet. */
const PENDING = '';

async function readStored<T>(
  playerId: string,
  key: string,
  endpoint: string,
): Promise<{ replay: true; value: T } | null> {
  const rows = await db
    .select({
      endpoint: schema.idempotencyKeys.endpoint,
      response: schema.idempotencyKeys.response,
    })
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.playerId, playerId),
        eq(schema.idempotencyKeys.key, key),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  /*
   * The same key arriving at a different endpoint is a client bug, and
   * replaying a harvest response to a plant request would be far worse than an
   * error. Refuse it.
   */
  if (row.endpoint !== endpoint) {
    throw new GameError(
      ErrorCode.VALIDATION_FAILED,
      'That idempotency key was already used for a different action.',
    );
  }

  if (row.response === PENDING) return null;
  return { replay: true, value: JSON.parse(row.response) as T };
}

/**
 * Runs `work` exactly once per (player, key), inside a transaction.
 *
 * A replayed key returns the stored response without re-running anything. A key
 * whose first attempt FAILED is free to be retried — the transaction rolled
 * back, taking the key row with it, which is the behaviour you want when the
 * failure was transient.
 */
export async function runIdempotent<T>(
  playerId: string,
  key: string,
  endpoint: string,
  now: number,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const stored = await readStored<T>(playerId, key, endpoint);
  if (stored) return stored.value;

  try {
    return await db.transaction(async (tx) => {
      await tx.insert(schema.idempotencyKeys).values({
        key,
        playerId,
        endpoint,
        response: PENDING,
        createdAt: now,
      });

      const result = await work(tx);

      await tx
        .update(schema.idempotencyKeys)
        .set({ response: JSON.stringify(result) })
        .where(
          and(
            eq(schema.idempotencyKeys.playerId, playerId),
            eq(schema.idempotencyKeys.key, key),
          ),
        );

      return result;
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;

    // Someone else got there first. Their response is authoritative.
    const replayed = await readStored<T>(playerId, key, endpoint);
    if (replayed) return replayed.value;

    /*
     * The winner inserted its key but has not committed a response yet, so
     * there is genuinely nothing to return. Telling the client to retry is
     * correct and safe — the key makes the retry free.
     */
    throw new GameError(
      ErrorCode.RATE_LIMITED,
      'That action is already being processed. Try again in a moment.',
    );
  }
}
