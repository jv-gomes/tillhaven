/**
 * Crash insurance.
 *
 * The document is snapshotted to localStorage on a debounce so a refresh, a
 * closed tab or an HMR reload never costs work. This is deliberately NOT the
 * save mechanism — the authored map only becomes real when it is written to
 * `apps/client/public/tilemaps/` and committed. localStorage is a scratch buffer
 * that survives a reload, nothing more.
 */

import type { MapDoc } from '../model/doc.js';
import { serialize, deserialize, type TiledMap } from './tiled.js';

const KEY = 'tillhaven.mapmaker.autosave';
const DEBOUNCE_MS = 500;

let timer: number | undefined;

export function scheduleAutosave(doc: MapDoc): void {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(serialize(doc)));
    } catch {
      // Quota exceeded or storage disabled. Losing the scratch buffer is not
      // worth interrupting the user over — explicit save still works.
    }
  }, DEBOUNCE_MS);
}

export function loadAutosave(): MapDoc | undefined {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return undefined;
    return deserialize(JSON.parse(raw) as TiledMap).doc;
  } catch {
    return undefined;
  }
}

export function clearAutosave(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Ignore — see above.
  }
}
