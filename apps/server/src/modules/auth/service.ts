import { sql, eq, or } from 'drizzle-orm';
import {
  GameError,
  ErrorCode,
  STARTING_GOLD,
  STARTING_ITEMS,
  type RegisterInput,
  type LoginInput,
} from '@tillhaven/shared';
import { db, schema } from '../../db/client.js';
import { hashPassword, verifyPassword, needsRehash } from './password.js';
import { createSession, type CreatedSession } from './session.js';
import { newFarmPlots, FARM_WIDTH, FARM_HEIGHT } from '../farm/layout.js';
import { logSecurityEvent } from '../../lib/securityLog.js';

/**
 * Registration and sign-in (CLAUDE.md §8).
 *
 * Business logic lives here; the route handlers only parse, call, and respond
 * (§10).
 */

export interface AuthResult {
  readonly playerId: string;
  readonly username: string;
  readonly session: CreatedSession;
}

/**
 * Creates the player, their farm, and every plot position in ONE transaction
 * (§4.3).
 *
 * A partial failure must not leave a player who cannot farm, or a farm with no
 * owner. Postgres rolls the whole thing back.
 */
export async function register(
  input: RegisterInput,
  now: number,
): Promise<AuthResult> {
  // Hashing is slow and does not need the transaction open while it runs.
  const passwordHash = await hashPassword(input.password);

  const created = await db.transaction(async (tx) => {
    /*
     * No pre-flight "is this taken?" SELECT. Two simultaneous registrations
     * would both pass it and one would still fail on insert, so the check
     * would be decoration. The unique indexes are the actual guarantee; the
     * violation is caught below and translated.
     */
    let playerId: string;
    try {
      const rows = await tx
        .insert(schema.players)
        .values({
          username: input.username,
          email: input.email,
          passwordHash,
          gold: STARTING_GOLD,
          createdAt: now,
          lastSeenAt: now,
        })
        .returning({ id: schema.players.id });

      playerId = rows[0]!.id;
    } catch (err) {
      throw translateUniqueViolation(err);
    }

    const farmRows = await tx
      .insert(schema.farms)
      .values({
        playerId,
        houseTier: 0,
        chestTier: 0,
        width: FARM_WIDTH,
        height: FARM_HEIGHT,
        createdAt: now,
      })
      .returning({ id: schema.farms.id });

    const farmId = farmRows[0]!.id;

    // One insert for every plot, not one per plot.
    await tx.insert(schema.plots).values(
      newFarmPlots().map((p) => ({
        farmId,
        x: p.x,
        y: p.y,
        unlocked: p.unlocked,
      })),
    );

    /*
     * The starter kit. Inserted directly rather than through addItem: the
     * inventory is provably empty at this point, so there is no stacking or
     * capacity question to answer, and this stays inside the one transaction.
     */
    await tx.insert(schema.inventoryItems).values(
      STARTING_ITEMS.map((item, index) => ({
        playerId,
        container: 'inventory',
        slotIndex: index,
        itemId: item.itemId,
        quantity: item.quantity,
      })),
    );

    const session = await createSession(playerId, now, tx);
    return { playerId, session };
  });

  await logSecurityEvent({
    playerId: created.playerId,
    event: 'account_created',
    detail: input.username,
  });

  return {
    playerId: created.playerId,
    username: input.username,
    session: created.session,
  };
}

/**
 * Signs in with either an email address or a username.
 *
 * Returns the same `INVALID_CREDENTIALS` for an unknown account and a wrong
 * password, and always performs a password verification even when no account
 * matched — otherwise the response time alone reveals which usernames exist,
 * and the endpoint becomes an account-enumeration oracle.
 */
export async function login(
  input: LoginInput,
  now: number,
  ip: string | undefined,
): Promise<AuthResult> {
  const identifier = input.identifier.toLowerCase();

  const rows = await db
    .select({
      id: schema.players.id,
      username: schema.players.username,
      passwordHash: schema.players.passwordHash,
    })
    .from(schema.players)
    .where(
      or(
        eq(sql`lower(${schema.players.username})`, identifier),
        eq(sql`lower(${schema.players.email})`, identifier),
      ),
    )
    .limit(1);

  const player = rows[0];

  /*
   * The decoy. `verifyPassword` returns false for an unparseable hash rather
   * than throwing, so running it against a dummy costs the same argon2 work as
   * a real check and keeps the timing of "no such user" indistinguishable from
   * "wrong password".
   */
  const ok = await verifyPassword(
    player?.passwordHash ?? DECOY_HASH,
    input.password,
  );

  if (!player || !ok) {
    await logSecurityEvent({
      playerId: player?.id ?? null,
      event: 'login_failed',
      ip,
      detail: input.identifier.slice(0, 64),
    });
    throw new GameError(
      ErrorCode.INVALID_CREDENTIALS,
      'That email or password is not right.',
    );
  }

  // Only ever on a SUCCESSFUL login: doing this on failure would add
  // observable time to exactly the path that must not leak any.
  if (needsRehash(player.passwordHash)) {
    const rehashed = await hashPassword(input.password);
    await db
      .update(schema.players)
      .set({ passwordHash: rehashed })
      .where(eq(schema.players.id, player.id));
  }

  const session = await createSession(player.id, now);

  await db
    .update(schema.players)
    .set({ lastSeenAt: now })
    .where(eq(schema.players.id, player.id));

  return { playerId: player.id, username: player.username, session };
}

/**
 * A real argon2id hash of a value nobody knows, used to burn the same CPU on a
 * missing account as on a real one. Generated once at module load rather than
 * hardcoded, so it is never a recognisable constant.
 */
const DECOY_HASH = await hashPassword(
  `decoy-${Math.random()}-${process.pid}-${Date.now()}`,
);

/**
 * Turns a Postgres unique-violation into the right machine-readable code.
 *
 * Which index was violated is the only way to tell the caller whether it was
 * the username or the email. Note this does reveal that some account holds
 * that email — unavoidable for a usable signup form, and standard practice.
 */
function translateUniqueViolation(err: unknown): unknown {
  const constraint =
    typeof err === 'object' && err !== null && 'constraint_name' in err
      ? String((err as { constraint_name: unknown }).constraint_name)
      : '';

  if (constraint === 'players_username_lower_idx') {
    return new GameError(ErrorCode.USERNAME_TAKEN, 'That farm name is taken.');
  }
  if (constraint === 'players_email_lower_idx') {
    return new GameError(
      ErrorCode.EMAIL_TAKEN,
      'There is already an account with that email.',
    );
  }
  return err;
}
