import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, needsRehash } from './password.js';

// argon2 is deliberately slow. These run in a few seconds, not milliseconds.
const TIMEOUT = 30_000;

describe('hashPassword', () => {
  it('produces a verifiable argon2id hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  }, TIMEOUT);

  it('salts: the same password twice gives different hashes', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same password'),
      hashPassword('same password'),
    ]);
    expect(a).not.toBe(b);
    // ...and both still verify.
    expect(await verifyPassword(a, 'same password')).toBe(true);
    expect(await verifyPassword(b, 'same password')).toBe(true);
  }, TIMEOUT);

  it('never embeds the plaintext in the hash', async () => {
    const secret = 'zzTillhavenSecretzz';
    const hash = await hashPassword(secret);
    expect(hash).not.toContain(secret);
  }, TIMEOUT);

  it('handles unicode and long passphrases', async () => {
    const pw = '🌱 vou plantar alho-poró às 6h 🌱 '.repeat(4);
    const hash = await hashPassword(pw);
    expect(await verifyPassword(hash, pw)).toBe(true);
  }, TIMEOUT);
});

describe('verifyPassword', () => {
  it('rejects the wrong password', async () => {
    const hash = await hashPassword('the right one');
    expect(await verifyPassword(hash, 'the wrong one')).toBe(false);
  }, TIMEOUT);

  it('is case sensitive and whitespace sensitive', async () => {
    const hash = await hashPassword('MyPassphrase');
    expect(await verifyPassword(hash, 'mypassphrase')).toBe(false);
    expect(await verifyPassword(hash, ' MyPassphrase')).toBe(false);
    expect(await verifyPassword(hash, 'MyPassphrase ')).toBe(false);
  }, TIMEOUT);

  /*
   * The important cases. A malformed stored hash must look exactly like a wrong
   * password to the caller — if it threw, the resulting 500 would tell an
   * attacker which accounts have damaged credential rows.
   */
  it.each([
    ['empty string', ''],
    ['not a hash at all', 'hunter2'],
    ['truncated argon2 hash', '$argon2id$v=19$m=19456,t=2,p=1$abc'],
    ['wrong algorithm marker', '$notargon$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'],
    ['bcrypt hash', '$2b$12$abcdefghijklmnopqrstuv'],
    ['only a dollar sign', '$'],
  ])('returns false, does not throw, for %s', async (_label, stored) => {
    await expect(verifyPassword(stored, 'anything')).resolves.toBe(false);
  }, TIMEOUT);

  it('returns false for an empty candidate password', async () => {
    const hash = await hashPassword('something');
    expect(await verifyPassword(hash, '')).toBe(false);
  }, TIMEOUT);
});

describe('needsRehash', () => {
  it('is false for a hash made with the current parameters', async () => {
    const hash = await hashPassword('current params');
    expect(needsRehash(hash)).toBe(false);
  }, TIMEOUT);

  it('is true for a hash made with weaker parameters', () => {
    // Hand-written header with a much lower memory cost.
    const weak = '$argon2id$v=19$m=4096,t=1,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaA';
    expect(needsRehash(weak)).toBe(true);
  });

  it('is true for an unparseable hash rather than throwing', () => {
    expect(needsRehash('')).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });
});
