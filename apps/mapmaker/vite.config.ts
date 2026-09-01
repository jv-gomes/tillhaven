import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { resolve, sep } from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The editor and the game must agree byte-for-byte on where assets live.
 * Pointing `publicDir` at the client's public folder means the manifest paths in
 * `@tillhaven/shared/config` (`/assets/tileset-grass-spring.png`, ...) resolve here
 * exactly as they do in the game, with no copies and no symlinks to drift.
 * `pnpm assets` stays the only thing that writes those files.
 */
const CLIENT_PUBLIC = resolve(__dirname, '../client/public');

/** Where authored maps land, and where the game will load them from. */
const TILEMAP_DIR = resolve(CLIENT_PUBLIC, 'tilemaps');

/** Calibration data lives in source, not in public — it is editor input. */
const TERRAIN_FILE = resolve(__dirname, 'src/tilesets/terrain-sets.json');

const MAX_BODY_BYTES = 4 * 1024 * 1024;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error('Payload too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(payload);
}

/**
 * Write through a temp file so an interrupted save can never truncate a map that
 * was already good. `rename` within the same directory is atomic on every
 * platform we care about.
 */
async function writeAtomic(target: string, contents: string): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, target);
}

/**
 * Dev-only save endpoint.
 *
 * This lives in `configureServer`, which Vite only ever calls for `vite dev`.
 * There is therefore no build in which this code path exists, and `apps/server`
 * — the thing that actually faces the internet — is not touched at all. That is
 * the whole reason the editor is its own app rather than a route on the game
 * server (CLAUDE.md §8: no unauthenticated write path to disk in production).
 */
function devSavePlugin(): Plugin {
  return {
    name: 'tillhaven:map-save',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/__save-map', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        void (async () => {
          try {
            const raw = await readBody(req);
            const body: unknown = JSON.parse(raw);
            if (typeof body !== 'object' || body === null) {
              json(res, 400, { error: 'BAD_BODY' });
              return;
            }

            const { name, map } = body as { name?: unknown; map?: unknown };
            if (typeof name !== 'string' || !/^[a-z0-9-]{1,64}$/.test(name)) {
              json(res, 400, { error: 'BAD_NAME' });
              return;
            }
            if (typeof map !== 'object' || map === null) {
              json(res, 400, { error: 'BAD_MAP' });
              return;
            }

            // Build the filename server-side rather than trusting the client
            // with an extension, then confirm the resolved path never escaped
            // the tilemap directory.
            const target = resolve(TILEMAP_DIR, `${name}.json`);
            if (!target.startsWith(TILEMAP_DIR + sep)) {
              json(res, 400, { error: 'PATH_ESCAPE' });
              return;
            }

            await mkdir(TILEMAP_DIR, { recursive: true });
            await writeAtomic(target, `${JSON.stringify(map, null, 2)}\n`);
            json(res, 200, { ok: true, path: `/tilemaps/${name}.json` });
          } catch (err) {
            json(res, 500, { error: String(err) });
          }
        })();
      });

      // Terrain calibration is editor configuration, so it writes to source and
      // gets committed. Same guards, fixed destination — no name comes from the
      // client at all.
      server.middlewares.use('/__save-terrain', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        void (async () => {
          try {
            const raw = await readBody(req);
            const body: unknown = JSON.parse(raw);
            if (!Array.isArray(body)) {
              json(res, 400, { error: 'BAD_BODY' });
              return;
            }
            await writeAtomic(TERRAIN_FILE, `${JSON.stringify(body, null, 2)}\n`);
            json(res, 200, { ok: true });
          } catch (err) {
            json(res, 500, { error: String(err) });
          }
        })();
      });
    },
  };
}

export default defineConfig({
  publicDir: CLIENT_PUBLIC,
  plugins: [devSavePlugin()],
  server: {
    port: 5174,
  },
  build: {
    target: 'es2022',
    // The editor is a development tool. It is excluded from the root `build`
    // script and is never deployed; this block exists only so `vite build`
    // works if someone wants a static copy.
    outDir: 'dist',
  },
});
