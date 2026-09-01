import { db, schema } from '../db/client.js';

/**
 * Security-relevant events (CLAUDE.md §8): failed logins, trade executions,
 * VIP grants, refunds.
 *
 * Never pass a password, a session token, or any other secret as `detail`.
 */
export interface SecurityEvent {
  readonly playerId?: string | null;
  readonly event: string;
  readonly ip?: string | undefined;
  readonly detail?: string | undefined;
}

/**
 * Writes an audit row. Deliberately swallows its own failures: an audit write
 * that cannot complete must not turn a successful login into a 500. The
 * failure is logged to stderr so it is still visible.
 */
export async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  try {
    await db.insert(schema.securityLog).values({
      playerId: event.playerId ?? null,
      event: event.event,
      ip: event.ip ?? null,
      detail: event.detail ?? null,
    });
  } catch (err) {
    console.error('[tillhaven] failed to write security_log entry', {
      event: event.event,
      err,
    });
  }
}
