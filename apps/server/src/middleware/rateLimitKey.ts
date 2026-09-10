import { createHash } from 'node:crypto';

/**
 * What the rate limiter counts against (T-14.07, CLAUDE.md §8).
 *
 * §8 asks for a limit **"per account and per IP"**, and until this existed only
 * half of that was true: every authenticated route used `@fastify/rate-limit`'s
 * default key, which is `request.ip`. That is the wrong half to have alone for
 * an idle game. §8's own reasoning is *"assume automation and design so that
 * automation gains little"* — and an IP-only limit is the one a script defeats
 * most cheaply, because rotating residential proxies are a commodity while
 * accounts cost a registration. It also punishes the wrong people: a household
 * or a campus behind one NAT shares a single budget.
 *
 * So: **the session identifies the caller when there is one, and the IP does
 * when there is not.** The global limiter stays IP-keyed as the backstop
 * against one machine flooding the box, which is the other half of §8.
 *
 * **This is per SESSION, not strictly per account, and that is a real
 * limitation.** A player can hold several sessions at once — two browsers, a
 * phone — and each gets its own budget. Making it per account would mean
 * resolving the token to a player id, which is a database round trip in an
 * `onRequest` hook on every request including the hottest path in the game
 * (§11). The multiplier is bounded rather than open: minting a session costs a
 * login, and login is capped at 10 per 15 minutes per (IP, identifier) by its
 * own `keyGenerator`. Ten budgets per quarter hour per account per address is a
 * far smaller prize than the unlimited one an IP-only key hands out.
 *
 * **The token is hashed, never used raw.** A rate-limit key is stored — in
 * memory here, in Redis in a clustered deployment — and a session token is a
 * bearer credential (§8). Putting one into that store verbatim would turn a
 * limiter dump into an account takeover. `resolveSession` already hashes for
 * exactly this reason; this is the same discipline at a different layer.
 */

/** Long enough that collisions are not a concern, short enough to store. */
const KEY_BYTES = 16;

export function rateLimitKey(sessionToken: string | undefined, ip: string): string {
  if (!sessionToken) return `ip:${ip}`;

  const digest = createHash('sha256').update(sessionToken).digest('hex').slice(0, KEY_BYTES * 2);
  return `s:${digest}`;
}
