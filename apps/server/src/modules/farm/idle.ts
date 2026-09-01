import { eq } from 'drizzle-orm';
import {
  ErrorCode,
  GameError,
  IDLE_TASK_TYPES,
  IdleTask,
  isCropId,
  type CropId,
  type IdleSettings,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Queryable, Tx } from '../../db/tx.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * Idle mode's settings (T-13.02, CLAUDE.md §5.3).
 *
 * This module owns the four `farms.idle_*` columns: reading them into a view,
 * and replacing them from a validated intent. It does NOT simulate anything —
 * that is T-13.03's pure simulator and T-13.04's applier. The one thing it does
 * have to get right today is the **watermark**, because a watermark that is
 * wrong in the wrong direction is either lost work or minted work.
 */

/**
 * `farms.idle_tasks` is a JSON array in a text column (see the schema), so it
 * is parsed rather than read.
 *
 * **Nothing that comes out of the database is trusted to be a task.** The
 * column is text; a bad migration, a manual `UPDATE`, or a future version
 * writing a task this build has never heard of would all land here. Anything
 * unrecognised is dropped rather than thrown on — refusing to serve a farm
 * because one word in a settings column is unfamiliar would take the game away
 * from the player over a setting they can simply set again.
 */
export function parseIdleTasks(stored: string): IdleTask[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  return canonicalTasks(raw.filter((t): t is string => typeof t === 'string'));
}

/**
 * The stored form of a task set: `IDLE_TASK_TYPES` order, known tasks only, no
 * duplicates.
 *
 * Canonical because the set is what the player chose and the order is the
 * config's — the simulator walks the list in dependency order (you cannot plant
 * ground you have not tilled), so storing whatever order the request arrived in
 * would make the column's meaning depend on a client's array literal.
 *
 * It takes `string[]`, not `IdleTask[]`, and dropping the unknown ones is
 * **this function's job alone**. `parseIdleTasks` used to filter with
 * `isIdleTask` first; a break-test found that filter could be deleted with no
 * test failing, because building the result from `IDLE_TASK_TYPES` already
 * excludes anything unrecognised. Two mechanisms for one rule is how one of
 * them quietly stops being true.
 */
export function canonicalTasks(tasks: readonly string[]): IdleTask[] {
  const chosen = new Set(tasks);
  return IDLE_TASK_TYPES.filter((t) => chosen.has(t));
}

/**
 * `farms.idle_crop_id` as a crop, or null.
 *
 * Same reasoning as `parseIdleTasks`: the column is text and not a foreign key
 * (crops are config, not a table), so a crop this build does not know reads as
 * "sow nothing" rather than as a crash. Shared with the farm view (T-13.05) so
 * the settings endpoint and the poll cannot disagree about what is being sown.
 */
export function parseIdleCropId(stored: string | null): CropId | null {
  return stored !== null && isCropId(stored) ? (stored as CropId) : null;
}

type FarmIdleRow = {
  idleEnabled: boolean;
  idleTasks: string;
  idleCropId: string | null;
  idleProcessedAt: number | null;
};

function viewOf(row: FarmIdleRow): IdleSettings {
  return {
    enabled: row.idleEnabled,
    tasks: parseIdleTasks(row.idleTasks),
    cropId: parseIdleCropId(row.idleCropId),
    processedAt: row.idleProcessedAt,
  };
}

const IDLE_COLUMNS = {
  idleEnabled: schema.farms.idleEnabled,
  idleTasks: schema.farms.idleTasks,
  idleCropId: schema.farms.idleCropId,
  idleProcessedAt: schema.farms.idleProcessedAt,
} as const;

/** The caller's standing orders. Ownership comes from the session (§8). */
export async function idleSettings(q: Queryable, player: AuthedPlayer): Promise<IdleSettings> {
  const rows = await q
    .select(IDLE_COLUMNS)
    .from(schema.farms)
    .where(eq(schema.farms.playerId, player.id))
    .limit(1);

  const row = rows[0];
  if (!row) throw new GameError(ErrorCode.NOT_FOUND, 'That farm does not exist.');
  return viewOf(row);
}

export interface SetIdleSettingsInput {
  readonly enabled: boolean;
  readonly tasks: readonly IdleTask[];
  readonly cropId: CropId | null;
}

/**
 * Replaces the standing orders.
 *
 * Two rules do the real work here:
 *
 * **The watermark is settled to `now` on every successful write.** Not only on
 * enable — on every write, including disabling and including a change of tasks
 * while already enabled. The alternative is that `idle_processed_at` can be
 * left pointing at a moment before settings that are no longer in force, and
 * the applier would then replay a backlog under rules the player did not have
 * at the time. Setting it forward is what makes "you cannot mint idle work out
 * of time you were not idling" true by construction, rather than true as long
 * as every future caller remembers.
 *
 * **Since T-13.04 nothing is discarded**: the route runs `catchUpIdle`
 * immediately before this, so the pending window has already been paid out and
 * committed, and the watermark it left behind is what this settles forward
 * from. Settling remains unconditional — the applier can legitimately
 * decline to move the watermark (a window shorter than one action), and this
 * endpoint must still leave no stretch of disabled time to be replayed later.
 *
 * **It never goes backwards.** `Math.max` against what is stored, so a clock
 * adjustment cannot reopen a window that was already settled.
 */
export async function setIdleSettings(
  tx: Tx,
  player: AuthedPlayer,
  input: SetIdleSettingsInput,
  now: number,
): Promise<IdleSettings> {
  const tasks = canonicalTasks(input.tasks);

  /*
   * Told to plant, but not told what. Refused rather than accepted-and-ignored:
   * the farmer would till a field and sow nothing, which is indistinguishable
   * from a broken feature. Checked before the row is locked — nothing about
   * this needs the database.
   */
  if (tasks.includes(IdleTask.PLANT) && input.cropId === null) {
    throw new GameError(
      ErrorCode.IDLE_CROP_REQUIRED,
      'Choose a crop for your farmer to plant.',
      { task: IdleTask.PLANT },
    );
  }

  const rows = await tx
    .select({ id: schema.farms.id, ...IDLE_COLUMNS })
    .from(schema.farms)
    .where(eq(schema.farms.playerId, player.id))
    .limit(1)
    .for('update');

  const row = rows[0];
  if (!row) throw new GameError(ErrorCode.NOT_FOUND, 'That farm does not exist.');

  // `catchUpIdle` has already run and committed (see `afterIdleCatchUp` in
  // routes.ts), so `row.idleProcessedAt` is post-payout and this only ever
  // settles time the farmer could not have worked.
  const processedAt = Math.max(row.idleProcessedAt ?? now, now);

  const next = {
    idleEnabled: input.enabled,
    idleTasks: JSON.stringify(tasks),
    idleCropId: input.cropId,
    idleProcessedAt: processedAt,
  };

  await tx.update(schema.farms).set(next).where(eq(schema.farms.id, row.id));

  return viewOf(next);
}
