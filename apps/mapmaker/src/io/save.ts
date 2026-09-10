/**
 * Getting a finished map out of the editor.
 *
 * Two routes, because they fail differently: the dev-server write is the fast
 * loop (save, alt-tab to the game, reload) but only exists under `vite dev`,
 * while the download always works and is the fallback if the endpoint is gone.
 */

import type { GroundAnimation } from '@tillhaven/shared/config';
import type { MapDoc } from '../model/doc.js';
import type { TerrainSet } from '../tilesets/terrain.js';
import { serialize } from './tiled.js';

export interface SaveResult {
  ok: boolean;
  message: string;
}

export const DEFAULT_MAP_NAME = 'farm';

export async function saveToProject(doc: MapDoc, name = DEFAULT_MAP_NAME): Promise<SaveResult> {
  const map = serialize(doc);
  try {
    const res = await fetch('/__save-map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, map }),
    });
    const body = (await res.json()) as { path?: string; error?: string };
    if (!res.ok) return { ok: false, message: body.error ?? `HTTP ${res.status}` };
    return { ok: true, message: `Saved to apps/client/public${body.path ?? ''}` };
  } catch (err) {
    return { ok: false, message: `Save failed: ${String(err)}` };
  }
}

export async function saveTerrainSets(sets: readonly TerrainSet[]): Promise<SaveResult> {
  try {
    const res = await fetch('/__save-terrain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sets),
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      return { ok: false, message: body.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, message: 'Saved src/tilesets/terrain-sets.json' };
  } catch (err) {
    return { ok: false, message: `Save failed: ${String(err)}` };
  }
}

/**
 * Writes the authored animation library into shared config.
 *
 * Unlike the map and the terrain sets, saving this changes a file the GAME
 * imports — so the failure is reported in full rather than as "save failed".
 * The endpoint refuses the whole library if any entry is malformed (it is
 * emitting TypeScript), and knowing which entry is the difference between a
 * fixable mistake and a panel that will not save for no visible reason.
 */
export async function saveGroundAnimations(
  animations: readonly GroundAnimation[],
): Promise<SaveResult> {
  try {
    const res = await fetch('/__save-ground-anim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(animations),
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string; problems?: string[] };
      const detail = body.problems?.length ? `: ${body.problems.join('; ')}` : '';
      return { ok: false, message: `${body.error ?? `HTTP ${res.status}`}${detail}` };
    }
    return {
      ok: true,
      message: 'Saved packages/shared/src/config/groundAnim.generated.ts — reload the game to see it',
    };
  } catch (err) {
    return { ok: false, message: `Save failed: ${String(err)}` };
  }
}

export function downloadMap(doc: MapDoc, name = DEFAULT_MAP_NAME): void {
  const json = `${JSON.stringify(serialize(doc), null, 2)}\n`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
