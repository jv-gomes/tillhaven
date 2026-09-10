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

/**
 * The authored animation library.
 *
 * In `packages/shared`, not here, because unlike terrain calibration this is
 * read by the GAME as well as the editor: the Farm scene resolves an `animId`
 * out of it. Editor-only data may live in the editor; anything both sides read
 * is shared config (CLAUDE.md §4.4).
 */
const GROUND_ANIM_FILE = resolve(
  __dirname,
  '../../packages/shared/src/config/groundAnim.generated.ts',
);

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
 * Turns a posted animation library into the generated TypeScript file.
 *
 * **The endpoint writes code, so it validates rather than trusts.** Every field
 * is checked against a shape and a character set before anything is emitted, and
 * the emitted text is built from `JSON.stringify` of values that have already
 * passed — the request body is never interpolated into the output. Nothing from
 * the client reaches the file as-is.
 *
 * This is dev-only in the same way the map save is (see `devSavePlugin`), so it
 * exists in no build and `apps/server` is not involved. Even so, an endpoint
 * that writes a `.ts` file the game imports is the one place in this tool where
 * a lax check would be more than a bad map, which is why the rules below are
 * stricter than the format strictly needs.
 *
 * Returns the file text, or a list of what was wrong with the request.
 */
const ANIM_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHEET_KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Printable, no control characters — it ends up inside a comment and a string. */
const NAME_RE = /^[\p{L}\p{N} '()\-.,&/]{1,64}$/u;
const MAX_ANIMATIONS = 200;
const MAX_FRAMES = 64;
const MAX_FPS = 60;

function buildGroundAnimFile(body: unknown): { text?: string; problems: string[] } {
  const problems: string[] = [];
  if (!Array.isArray(body)) return { problems: ['body must be an array'] };
  if (body.length > MAX_ANIMATIONS) return { problems: [`at most ${MAX_ANIMATIONS} animations`] };

  const seen = new Set<string>();
  const clean: { id: string; name: string; fps: number; frames: { sheet: string; frame: number }[] }[] =
    [];

  for (const [index, raw] of body.entries()) {
    const at = `[${index}]`;
    if (typeof raw !== 'object' || raw === null) {
      problems.push(`${at}: not an object`);
      continue;
    }
    const { id, name, fps, frames } = raw as Record<string, unknown>;

    if (typeof id !== 'string' || !ANIM_ID_RE.test(id)) {
      problems.push(`${at}: bad id`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`${at}: duplicate id "${id}"`);
      continue;
    }
    seen.add(id);

    if (typeof name !== 'string' || !NAME_RE.test(name)) {
      problems.push(`${id}: bad name`);
      continue;
    }
    if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0 || fps > MAX_FPS) {
      problems.push(`${id}: fps must be in 0..${MAX_FPS}`);
      continue;
    }
    if (!Array.isArray(frames) || frames.length === 0 || frames.length > MAX_FRAMES) {
      problems.push(`${id}: 1..${MAX_FRAMES} frames required`);
      continue;
    }

    const cleanFrames: { sheet: string; frame: number }[] = [];
    for (const [fi, frame] of frames.entries()) {
      if (typeof frame !== 'object' || frame === null) {
        problems.push(`${id}[${fi}]: not an object`);
        continue;
      }
      const { sheet, frame: n } = frame as Record<string, unknown>;
      if (typeof sheet !== 'string' || !SHEET_KEY_RE.test(sheet)) {
        problems.push(`${id}[${fi}]: bad sheet key`);
        continue;
      }
      // The frame is NOT checked against the sheet's tile count here — that
      // needs the asset manifest, which is the editor's job and is reported in
      // the panel. This bound only stops an absurd number reaching the file.
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100_000) {
        problems.push(`${id}[${fi}]: bad frame index`);
        continue;
      }
      cleanFrames.push({ sheet, frame: n });
    }
    if (cleanFrames.length !== frames.length) continue;

    clean.push({ id, name, fps, frames: cleanFrames });
  }

  if (problems.length > 0) return { problems };

  const entries = clean
    .map((a) => {
      const frames = a.frames
        .map((f) => `      { sheet: ${JSON.stringify(f.sheet)}, frame: ${f.frame} },`)
        .join('\n');
      return [
        '  {',
        `    id: ${JSON.stringify(a.id)},`,
        `    name: ${JSON.stringify(a.name)},`,
        `    fps: ${a.fps},`,
        '    frames: [',
        frames,
        '    ],',
        '  },',
      ].join('\n');
    })
    .join('\n');

  const header = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by the map editor's **Animations** panel (\`pnpm dev:mapmaker\` →
 * "Save animations"), which posts to a dev-only Vite endpoint that serialises
 * this file from validated data. To change an animation, edit it there and save
 * — hand edits here are overwritten by the next save.
 *
 * **This is the WHAT; the map is only the WHERE.** \`farm.json\` stamps an
 * \`animId\` on a cell and nothing else, so re-timing an animation or swapping a
 * frame is an edit to this file and does not touch a single map. That is why
 * this is committed shared config rather than map data (CLAUDE.md §4.4): the
 * mapmaker writes it and the Farm scene reads it, and the two cannot disagree.
 *
 * Frames index the existing asset manifest by sheet key, so nothing here can
 * renumber \`TILESET_RUNS\` or force a map regeneration.
 */

import type { GroundAnimation } from './groundAnim.js';
`;

  const text =
    clean.length === 0
      ? `${header}\nexport const AUTHORED_GROUND_ANIMATIONS: readonly GroundAnimation[] = [];\n`
      : `${header}\nexport const AUTHORED_GROUND_ANIMATIONS: readonly GroundAnimation[] = [\n${entries}\n];\n`;

  return { text, problems: [] };
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

      // The animation library. Same shape as the terrain save — fixed
      // destination, no name from the client — but it emits TypeScript rather
      // than JSON, so `buildGroundAnimFile` validates every field first and
      // builds the output from checked values only.
      server.middlewares.use('/__save-ground-anim', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        void (async () => {
          try {
            const raw = await readBody(req);
            const body: unknown = JSON.parse(raw);
            const { text, problems } = buildGroundAnimFile(body);
            if (!text) {
              json(res, 400, { error: 'INVALID', problems });
              return;
            }
            await writeAtomic(GROUND_ANIM_FILE, text);
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
    watch: {
      /*
       * Saving the animation library must not reload the editor.
       *
       * The file is in `packages/shared`, which the editor imports, so writing
       * it is a source change and Vite full-reloads on it — which happens to
       * throw away your selection and the "saved" message at the exact moment
       * you wanted to read it. Nothing is lost (the map autosaves and the
       * library was just written from memory), but a tool that reloads itself
       * every time you press Save reads as a tool that crashed.
       *
       * Ignoring it is safe precisely BECAUSE the editor is the only writer:
       * the in-memory library already equals what just landed on disk. The
       * game's dev server is a different Vite instance and still reloads, which
       * is what you want — the animation shows up there without a manual step.
       */
      ignored: ['**/packages/shared/src/config/groundAnim.generated.ts'],
    },
  },
  build: {
    target: 'es2022',
    // The editor is a development tool. It is excluded from the root `build`
    // script and is never deployed; this block exists only so `vite build`
    // works if someone wants a static copy.
    outDir: 'dist',
  },
});
