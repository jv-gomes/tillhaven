#!/usr/bin/env node
/**
 * Bundles the server for production.
 *
 *   pnpm --filter @tillhaven/server bundle
 *
 * ------------------------------------------------------------------
 * Why this exists: `pnpm start` did not work, and never had
 * ------------------------------------------------------------------
 *
 * `tsc -p tsconfig.build.json` emits correct JavaScript that Node cannot run.
 * TypeScript does not rewrite bare specifiers, so `dist/index.js` still says
 * `from '@tillhaven/shared'`, Node follows that to the workspace package, and
 * the package's `exports` point at **`./src/index.ts`** — TypeScript source,
 * which Node will not execute. It fails at boot with:
 *
 *     Cannot find module .../packages/shared/src/config/index.js
 *     imported from .../packages/shared/src/index.ts
 *
 * Nothing caught it because nothing had ever run the built output: `pnpm dev`
 * uses tsx (which reads TypeScript), the tests use Vitest (same), and there was
 * no deployment. The first thing to run `node dist/index.js` was the container.
 *
 * ------------------------------------------------------------------
 * Why bundling rather than making `shared` emit JavaScript
 * ------------------------------------------------------------------
 *
 * Pointing `@tillhaven/shared`'s `exports` at compiled output is the other fix,
 * and it costs more than it looks: every consumer then needs the package built
 * before it can run, so `pnpm dev` grows a build step, and keeping source
 * resolution for development means conditional exports plus a matching
 * `--conditions` flag on tsx, Vite and Vitest. Four places to keep in step, all
 * of them silent when wrong.
 *
 * Bundling changes nothing about development. The only consumer that needs
 * plain JavaScript is the production server, so that is the only place that
 * gets a bundler.
 *
 * ------------------------------------------------------------------
 * What is inlined and what is not
 * ------------------------------------------------------------------
 *
 * **Workspace code is inlined; real dependencies stay external.** The externals
 * list is read from `package.json` rather than typed out, so adding a
 * dependency cannot silently start bundling it.
 *
 * That split matters for one dependency in particular: **argon2 is a native
 * module** (CLAUDE.md §8's password hasher). Bundling a `.node` binding does
 * not work, so it — and everything else in `dependencies` — is required at
 * runtime from `node_modules`, which the image installs with
 * `pnpm install --prod`.
 */

import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..');

const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));

/**
 * Everything in `dependencies` except the workspace packages.
 *
 * A `workspace:*` dependency is source that lives in this repo and has no
 * published JavaScript to resolve at runtime — inlining it is the entire point.
 * Anything else is a real package that will be present in `node_modules`.
 */
const external = Object.entries(pkg.dependencies ?? {})
  .filter(([, spec]) => !String(spec).startsWith('workspace:'))
  .map(([name]) => name);

const result = await build({
  entryPoints: [join(PKG_ROOT, 'src/index.ts')],
  outfile: join(PKG_ROOT, 'dist/server.js'),
  bundle: true,
  platform: 'node',
  // Matches the `engines.node` floor in the root package.json.
  target: 'node20',
  format: 'esm',
  external,
  sourcemap: true,
  // Not minified on purpose: this is a server, the bytes do not travel, and a
  // readable stack trace in production logs is worth more than the kilobytes.
  minify: false,
  logLevel: 'info',
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(
  `bundled ${Object.keys(result.metafile.inputs).length} modules ` +
    `into dist/server.js (${(bytes / 1024).toFixed(0)} KB), ` +
    `${external.length} dependencies left external`,
);
