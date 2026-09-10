import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-22.04 — the dev server must proxy everything the client asks for.
 *
 * **The bug this exists to prevent was invisible for eighteen phases.**
 * `net/realtime.ts` calls `io()` with no URL, so the socket connects to the
 * page's own origin. In production that is Fastify, which serves the client and
 * the socket together, and it works. In dev it is Vite on :5173 — and Vite
 * proxied `/api` but not `/socket.io`.
 *
 * What made it silent rather than loud: Vite answered `/socket.io/` with its
 * **HTML fallback and a 200**, not a 404. Socket.IO received a page where a
 * handshake should be, could not parse it, and retried forever in polling mode.
 * The console stayed clean. The trade panel has an 8-second fallback poll
 * (T-4.10) which quietly carried the whole feature, so nothing looked broken —
 * it was just slow, and nobody knew there was a faster path to miss.
 *
 * Measured after the fix: an invite reached the other player in **75ms** and an
 * offer change in **463ms**, against a poll interval of 8000ms.
 *
 * A source scan rather than an import: `vite.config.ts` pulls in Vite's own
 * plugin types, and standing that up inside vitest to read four lines of
 * literal config would be more machinery than the check is worth.
 */

const CONFIG = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'vite.config.ts',
);
const source = readFileSync(CONFIG, 'utf8');

/** The block between `proxy: {` and the line that closes it. */
function proxyBlock(): string {
  const start = source.indexOf('proxy: {');
  expect(start, 'vite.config.ts has no proxy block at all').toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n    },', start));
}

describe('vite dev proxy', () => {
  it('proxies the API, or nothing works at all', () => {
    // The loud failure. Present only so this file cannot pass vacuously if the
    // block is ever restructured.
    expect(proxyBlock()).toContain("'/api'");
  });

  /**
   * The quiet one. Without this entry the socket connects to Vite, gets a 200
   * and an HTML page, and silently degrades to the fallback poll.
   */
  it('proxies the realtime socket', () => {
    expect(proxyBlock(), '/socket.io is not proxied — realtime will silently degrade').toContain(
      "'/socket.io'",
    );
  });

  /**
   * `ws: true` is not decoration. Without it Vite proxies the HTTP polling
   * handshake but refuses the upgrade, so the socket connects and then never
   * leaves long-polling — working, but not what it says on the tin.
   */
  it('allows the socket to upgrade to a websocket', () => {
    const block = proxyBlock();
    const socketEntry = block.slice(block.indexOf("'/socket.io'"));

    expect(socketEntry, "/socket.io is proxied without `ws: true`").toContain('ws: true');
  });

  /**
   * Both must point at the API. A proxy aimed somewhere else is the same class
   * of silent failure with a different address.
   */
  it('points both at the API server', () => {
    const targets = [...proxyBlock().matchAll(/target: '([^']+)'/g)].map((m) => m[1]);

    expect(targets.length, 'expected a target for each proxied path').toBe(2);
    for (const target of targets) expect(target).toBe('http://localhost:3000');
  });
});
