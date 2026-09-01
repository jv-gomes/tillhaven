import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, type TestClient } from '../../test/app.js';
import { STARTING_GOLD, STARTING_PLOTS, MAX_PLOTS } from '@tillhaven/shared';

let client: TestClient;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
});

afterAll(closeDb);

describe('POST /api/auth/register', () => {
  it('creates a player, a farm, and every plot in one go', async () => {
    const user = await registerTestUser(client);

    const [player] = await db
      .select()
      .from(schema.players)
      .where(eq(schema.players.id, user.id));

    expect(player!.gold).toBe(STARTING_GOLD);
    // No level column to seed: level 1 is what zero experience derives to.
    expect(player!.experience).toBe(0);

    const [farm] = await db
      .select()
      .from(schema.farms)
      .where(eq(schema.farms.playerId, user.id));
    expect(farm).toBeDefined();

    const plots = await db
      .select()
      .from(schema.plots)
      .where(eq(schema.plots.farmId, farm!.id));

    expect(plots).toHaveLength(MAX_PLOTS);
    expect(plots.filter((p) => p.unlocked)).toHaveLength(STARTING_PLOTS);
  });

  it('signs the new player in immediately', async () => {
    await registerTestUser(client);
    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.player.gold).toBe(STARTING_GOLD);
  });

  it('never returns the password or its hash', async () => {
    const res = await client.post('/api/auth/register', {
      username: 'hashcheck',
      email: 'hashcheck@example.test',
      password: 'a long enough passphrase',
    });
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('argon2');
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('a long enough passphrase');
  });

  it('stores the password only as an argon2id hash', async () => {
    const user = await registerTestUser(client);
    const [player] = await db
      .select()
      .from(schema.players)
      .where(eq(schema.players.id, user.id));

    expect(player!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(player!.passwordHash).not.toContain(user.password);
  });

  it('rejects a duplicate username, case-insensitively', async () => {
    await registerTestUser(client, { username: 'GreenHollow', email: 'a@example.test' });

    const res = await client.post('/api/auth/register', {
      username: 'greenhollow',
      email: 'b@example.test',
      password: 'a long enough passphrase',
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe('USERNAME_TAKEN');
  });

  it('rejects a duplicate email, case-insensitively', async () => {
    await registerTestUser(client, { username: 'first', email: 'Dup@Example.test' });

    const res = await client.post('/api/auth/register', {
      username: 'second',
      email: 'dup@example.TEST',
      password: 'a long enough passphrase',
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe('EMAIL_TAKEN');
  });

  it('leaves no orphan player when a registration fails', async () => {
    await registerTestUser(client, { username: 'taken', email: 'taken@example.test' });
    const before = await db.select().from(schema.players);

    await client.post('/api/auth/register', {
      username: 'taken',
      email: 'other@example.test',
      password: 'a long enough passphrase',
    });

    // The transaction rolled back: no half-made account, no ownerless farm.
    expect(await db.select().from(schema.players)).toHaveLength(before.length);
    expect(await db.select().from(schema.farms)).toHaveLength(before.length);
  });

  it.each([
    ['username too short', { username: 'ab', email: 'a@example.test', password: 'a long enough passphrase' }],
    ['username with punctuation', { username: 'bad name!', email: 'a@example.test', password: 'a long enough passphrase' }],
    ['malformed email', { username: 'okname', email: 'not-an-email', password: 'a long enough passphrase' }],
    ['password too short', { username: 'okname', email: 'a@example.test', password: 'short' }],
    ['missing fields', { username: 'okname' }],
  ])('rejects %s with VALIDATION_FAILED', async (_label, body) => {
    const res = await client.post('/api/auth/register', body);
    expect(res.status).toBe(400);
    expect(res.code).toBe('VALIDATION_FAILED');
  });

  it('does not echo submitted values back in validation errors', async () => {
    // A password among the submitted fields must not come back in the response.
    const res = await client.post('/api/auth/register', {
      username: 'ab',
      email: 'nope',
      password: 'sup3rSecretButTooShort',
    });
    expect(JSON.stringify(res.body)).not.toContain('sup3rSecretButTooShort');
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with a username', async () => {
    const user = await registerTestUser(client);
    const fresh = await createTestClient();

    const res = await fresh.post('/api/auth/login', {
      identifier: user.username,
      password: user.password,
    });

    expect(res.status).toBe(200);
    expect((await fresh.get('/api/auth/me')).body.player.username).toBe(user.username);
    await fresh.close();
  });

  it('signs in with an email, in any case', async () => {
    const user = await registerTestUser(client);
    const fresh = await createTestClient();

    const res = await fresh.post('/api/auth/login', {
      identifier: user.email.toUpperCase(),
      password: user.password,
    });

    expect(res.status).toBe(200);
    await fresh.close();
  });

  /*
   * The anti-enumeration requirement. A wrong password and an account that does
   * not exist must be indistinguishable — same status, same code, same body.
   */
  it('answers identically for a wrong password and an unknown account', async () => {
    const user = await registerTestUser(client);

    const wrongPassword = await client.post('/api/auth/login', {
      identifier: user.username,
      password: 'definitely not the password',
    });
    const noSuchUser = await client.post('/api/auth/login', {
      identifier: 'nobody_at_all',
      password: 'definitely not the password',
    });

    expect(wrongPassword.status).toBe(noSuchUser.status);
    expect(wrongPassword.code).toBe('INVALID_CREDENTIALS');
    expect(JSON.stringify(wrongPassword.body)).toBe(JSON.stringify(noSuchUser.body));
  });

  it('records failed logins without recording the attempted password', async () => {
    const user = await registerTestUser(client);
    await client.post('/api/auth/login', {
      identifier: user.username,
      password: 'hunter2isnotmypassword',
    });

    const rows = await db
      .select()
      .from(schema.securityLog)
      .where(eq(schema.securityLog.event, 'login_failed'));

    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain('hunter2isnotmypassword');
  });

  it("rejects a password that belongs to a different account", async () => {
    await registerTestUser(client, { username: 'alpha', password: 'alpha passphrase here' });

    const other = await createTestClient();
    await registerTestUser(other, { username: 'beta', password: 'beta passphrase here' });
    await other.close();

    const res = await client.post('/api/auth/login', {
      identifier: 'alpha',
      password: 'beta passphrase here',
    });
    expect(res.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session server-side, not just the cookie', async () => {
    await registerTestUser(client);
    const cookie = client.cookie;
    expect(cookie).toBeDefined();

    await client.post('/api/auth/logout');

    // Even replaying the captured cookie fails: the session is dead in the DB.
    const replay = await createTestClient();
    replay.cookie = cookie;
    const res = await replay.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.code).toBe('UNAUTHENTICATED');
    await replay.close();
  });

  it('is idempotent and works without a session', async () => {
    expect((await client.post('/api/auth/logout')).status).toBe(200);

    await registerTestUser(client);
    expect((await client.post('/api/auth/logout')).status).toBe(200);
    expect((await client.post('/api/auth/logout')).status).toBe(200);
  });
});

describe('authentication guard', () => {
  it.each([
    ['no cookie', undefined],
    ['garbage cookie', 'th_session=not-a-real-token'],
    ['empty cookie', 'th_session='],
  ])('returns UNAUTHENTICATED for %s', async (_label, cookie) => {
    const c = await createTestClient();
    c.cookie = cookie;

    for (const path of ['/api/auth/me', '/api/farm', '/api/inventory']) {
      const res = await c.get(path);
      expect(res.status, path).toBe(401);
      expect(res.code, path).toBe('UNAUTHENTICATED');
    }
    await c.close();
  });

  it('rejects a session whose player row is gone', async () => {
    const user = await registerTestUser(client);
    await db.delete(schema.players).where(eq(schema.players.id, user.id));

    const res = await client.get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
