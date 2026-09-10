import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-14.07 — every mutating endpoint declares its own limit.
 *
 * §8: *"Rate limit per account and per IP on all mutating endpoints. Idle games
 * are heavily botted."* The global backstop is 300/minute, which is a limit on
 * a machine melting the box, not on a script farming an account — so the
 * per-route budgets are the ones that matter, and a route that forgets one
 * silently inherits the loose global.
 *
 * **This is a source scan, and that is a deliberate trade.** Fastify does not
 * expose route-level `config` in a way that survives `printRoutes`, and the
 * alternative — an integration test per endpoint — would be 38 tests that each
 * spend a minute's budget. A grep is coarse, but it fails for the right reason
 * the day someone adds a POST without a limit, which is the whole job.
 */

const MODULES = join(import.meta.dirname, '..', 'modules');

interface Route {
  readonly file: string;
  readonly method: string;
  readonly path: string;
  readonly hasLimit: boolean;
}

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

function mutatingRoutes(): Route[] {
  const found: Route[] = [];

  for (const file of routeFiles(MODULES)) {
    const src = readFileSync(file, 'utf8');

    for (const match of src.matchAll(/app\.(post|put|patch|delete)\(\s*\n?\s*'([^']+)'/g)) {
      /*
       * Everything between the path and the handler is the route's options.
       * Bounded by the handler rather than by a character count: an options
       * object can carry a long comment, and a fixed window would call a
       * documented route uncovered — which is exactly what a first draft of
       * this scan did to `/logout`.
       */
      const after = src.slice(match.index + match[0].length);
      const handlerAt = after.search(/\basync\s*\(|\basync\s+function|\(\s*request/);
      const options = handlerAt === -1 ? after.slice(0, 600) : after.slice(0, handlerAt);

      found.push({
        file: file.slice(MODULES.length + 1),
        method: match[1]!.toUpperCase(),
        path: match[2]!,
        hasLimit: options.includes('rateLimit'),
      });
    }
  }

  return found;
}

describe('rate limit coverage', () => {
  it('finds the routes at all, so a broken scan cannot pass vacuously', () => {
    const routes = mutatingRoutes();

    // If the regex ever stops matching — a refactor to `app.route({...})`, say
    // — this test would otherwise report perfect coverage of nothing.
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.some((r) => r.path === '/till')).toBe(true);
    expect(routes.some((r) => r.path === '/chop')).toBe(true);
  });

  it('gives every mutating endpoint its own limit', () => {
    const uncovered = mutatingRoutes()
      .filter((r) => !r.hasLimit)
      .map((r) => `${r.method} ${r.path} (${r.file})`);

    expect(uncovered, 'these inherit the loose global backstop — see §8').toEqual([]);
  });
});
