import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schema } from './db/client.js';

/**
 * `privacy.html` against the schema it describes (T-26.01).
 *
 * The same argument `docs.test.ts` makes about the economy ledger, applied to
 * the document with the most outside exposure: **a privacy policy nobody is
 * forced to update stops being true, quietly, the first time a column is
 * added.** And a privacy policy that is not true is worse than no policy at
 * all — it is a false statement about what happens to someone's data, made to
 * them at the moment they hand it over.
 *
 * **What this test can and cannot do.** It cannot make the policy lawful. It
 * has no opinion on legal basis, retention, or GDPR — T-14.12 stays open for
 * exactly that reason and the page still carries its "not legally reviewed"
 * stamp. What it *can* do is refuse to let the page and the database drift
 * apart: every column of every table that holds data about a PERSON must be
 * deliberately classified, and everything classified as personal must be
 * described on the page.
 *
 * So adding `phoneNumber` to `players` fails CI twice — once for being
 * unclassified, and again if the page does not mention it. That is the whole
 * point. The failure arrives at the commit that creates the obligation, not at
 * an audit two years later.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PRIVACY = readFileSync(
  join(HERE, '..', '..', 'client', 'privacy.html'),
  'utf8',
).toLowerCase();

/**
 * The tables that hold data about the PERSON rather than about their farm.
 *
 * Game-state tables — plots, animals, inventory, decor, shipments — are
 * deliberately out of scope. They are personal data in the legal sense
 * (they attach to an identified account) and the page covers them in one
 * sentence, but listing every crop column here would bury the columns that
 * actually matter behind forty that do not, and a guard nobody can read is a
 * guard nobody maintains.
 */
const TABLES = {
  players: schema.players,
  sessions: schema.sessions,
  purchases: schema.purchases,
  securityLog: schema.securityLog,
  tradeLog: schema.tradeLog,
} as const;

/**
 * Every column of those tables, classified. A column here is either PERSONAL —
 * in which case the page must describe it — or listed as not personal, with a
 * reason.
 *
 * The value for a personal column is a phrase the page must contain. It is a
 * PHRASE and not the column name on purpose: the page is written for a reader,
 * so `password_hash` appears there as "stored only as an argon2 hash", and a
 * test that demanded the column name would push the page toward being a schema
 * dump.
 */
const PERSONAL: Readonly<Record<string, readonly string[]>> = {
  'players.username': ['username'],
  'players.email': ['email address'],
  'players.passwordHash': ['argon2 hash'],
  'players.appearance': ['appearance'],
  'players.createdAt': ['when the account was created'],
  'players.lastSeenAt': ['when it was last active'],

  'sessions.id': ['th_session'],
  'sessions.createdAt': ['th_session'],
  'sessions.expiresAt': ['th_session'],
  'sessions.revokedAt': ['th_session'],

  'purchases.stripeSessionId': ['stripe session'],
  'purchases.stripePaymentIntentId': ['payment identifiers'],
  'purchases.amount': ['the amount'],
  'purchases.currency': ['the currency'],
  'purchases.status': ['the status'],
  'purchases.refundedAt': ['refund'],

  'securityLog.event': ['security events'],
  'securityLog.ip': ['ip address'],
  'securityLog.detail': ['security events'],
  'securityLog.at': ['security events'],

  'tradeLog.initiatorItems': ['the items'],
  'tradeLog.recipientItems': ['the items'],
  'tradeLog.completedAt': ['the time'],
};

/**
 * Columns that are NOT about the person, each with the reason it is exempt.
 *
 * Written out rather than inferred, so that "this is just a key" is a decision
 * somebody made and can be disagreed with, instead of a gap.
 */
const NOT_PERSONAL: Readonly<Record<string, string>> = {
  'players.id': 'opaque surrogate key',
  'players.gold': 'game state, covered by the page in one sentence',
  'players.backpackTier': 'game state',
  'players.experience': 'game state',
  'players.energySpent': 'game state — a resource counter, like gold',
  /*
   * A timestamp about a person, but not one that says anything about them:
   * `sleepingSince` is when an in-game character lay down on an in-game bed,
   * which the player triggered by pressing a key. It reveals that the account
   * was active at that moment — and so does every other timestamp on this
   * table, including `createdAt`, which the page already covers.
   */
  'players.sleepingSince': 'game state — when the in-game character lay down',
  'players.vipUntil': 'entitlement, not an attribute of the person',
  'players.flaggedAt': 'entitlement state after a refund or chargeback',

  'sessions.playerId': 'foreign key to an opaque id',

  'purchases.id': 'opaque surrogate key',
  'purchases.playerId': 'foreign key to an opaque id',
  'purchases.createdAt': 'covered by the purchase record the page describes',

  'securityLog.id': 'opaque surrogate key',
  'securityLog.playerId': 'foreign key to an opaque id',

  'tradeLog.id': 'opaque surrogate key',
  'tradeLog.tradeId': 'foreign key to an opaque id',
  'tradeLog.initiatorId': 'the page says the log records BOTH PLAYERS',
  'tradeLog.recipientId': 'the page says the log records BOTH PLAYERS',
  'tradeLog.initiatorGold': 'game currency inside a trade the page describes',
  'tradeLog.recipientGold': 'game currency inside a trade the page describes',
};

function allColumns(): string[] {
  const out: string[] = [];
  for (const [table, def] of Object.entries(TABLES)) {
    for (const column of Object.keys(getTableColumns(def))) out.push(`${table}.${column}`);
  }
  return out;
}

describe('the privacy policy and the database', () => {
  it('classifies every column of every person-bearing table', () => {
    const unclassified = allColumns().filter(
      (key) => !(key in PERSONAL) && !(key in NOT_PERSONAL),
    );

    expect(
      unclassified,
      `new columns nobody has decided about — add them to PERSONAL (and describe ` +
        `them on privacy.html) or to NOT_PERSONAL with a reason: ${unclassified.join(', ')}`,
    ).toEqual([]);
  });

  it('classifies nothing that does not exist', () => {
    const real = new Set(allColumns());
    const stale = [...Object.keys(PERSONAL), ...Object.keys(NOT_PERSONAL)].filter(
      (key) => !real.has(key),
    );

    // A classification for a dropped column is a policy describing data that is
    // no longer held — the opposite failure, and just as untrue.
    expect(stale, `classified columns that no longer exist: ${stale.join(', ')}`).toEqual([]);
  });

  it('describes every personal column on the page', () => {
    const missing: string[] = [];
    for (const [key, phrases] of Object.entries(PERSONAL)) {
      if (!phrases.some((phrase) => PRIVACY.includes(phrase.toLowerCase()))) {
        missing.push(`${key} (looked for: ${phrases.join(' / ')})`);
      }
    }

    expect(missing, `held but not disclosed: ${missing.join('; ')}`).toEqual([]);
  });

  /**
   * A guard on the guard. If `getTableColumns` ever returns nothing — a schema
   * import that silently resolves to an empty object, say — every assertion
   * above passes vacuously and this file becomes decoration.
   */
  it('is actually looking at a schema', () => {
    expect(allColumns().length).toBeGreaterThan(30);
    expect(allColumns()).toContain('players.email');
    expect(PRIVACY.length).toBeGreaterThan(1000);
  });

  /**
   * Both legal pages point at a task that must actually be in the LIVE roadmap.
   *
   * They pointed at `T-0.10` until T-26.01 — a v1 id that survives only in
   * `docs/ROADMAP-v1.md`, so a reader who followed the pointer into
   * `ROADMAP.md` found nothing and could reasonably conclude the work had been
   * done. The live id is `T-14.12`. A dangling reference on the one page that
   * admits it is incomplete is the worst place to have one.
   */
  it('points both legal pages at a task the live roadmap still lists', () => {
    const roadmap = readFileSync(join(HERE, '..', '..', '..', 'ROADMAP.md'), 'utf8');

    for (const page of ['terms.html', 'privacy.html']) {
      const html = readFileSync(join(HERE, '..', '..', 'client', page), 'utf8');
      const ref = /Tracked as <code>(T-[\d.]+)<\/code>/.exec(html);

      expect(ref, `${page} no longer says which task tracks it`).not.toBeNull();
      expect(roadmap, `${page} points at ${ref![1]}, which is not in ROADMAP.md`).toContain(
        ref![1]!,
      );
    }
  });

  /**
   * The page must keep saying it is a draft for as long as T-14.12 is open.
   *
   * Without this, the most likely way the stamp disappears is somebody tidying
   * the page and reading it as finished — at which point an unreviewed document
   * is presented as a reviewed one, which is the single worst outcome available
   * here.
   */
  it('still admits it has not been legally reviewed', () => {
    for (const page of ['terms.html', 'privacy.html']) {
      const html = readFileSync(join(HERE, '..', '..', 'client', page), 'utf8').toLowerCase();
      expect(html, `${page} has dropped its draft stamp`).toContain('not legally reviewed');
    }
  });
});
