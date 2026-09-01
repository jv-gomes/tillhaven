/**
 * Image cache.
 *
 * Every tileset PNG is loaded once, up front, and drawn from thereafter. Vite's
 * `publicDir` points at `apps/client/public`, so the manifest paths
 * (`/assets/tileset-grass-spring.png`) resolve here exactly as they do in the game —
 * the editor and the game are looking at the same bytes.
 */

import { TILESET_RUNS } from '@tillhaven/shared/config';

const cache = new Map<string, HTMLImageElement>();

function load(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${path}`));
    img.src = path;
  });
}

export interface LoadReport {
  loaded: number;
  failed: string[];
}

export async function loadAllImages(): Promise<LoadReport> {
  const failed: string[] = [];
  let loaded = 0;

  await Promise.all(
    TILESET_RUNS.map(async (run) => {
      try {
        cache.set(run.key, await load(run.path));
        loaded++;
      } catch {
        // Keep going: one missing sheet should not blank the whole editor. The
        // usual cause is a forgotten `pnpm assets`, which the status bar says.
        failed.push(run.key);
      }
    }),
  );

  return { loaded, failed };
}

export function imageFor(key: string): HTMLImageElement | undefined {
  return cache.get(key);
}

/** Turn off smoothing on every context that draws pixel art. Canvas resets this
 *  whenever the backing store is resized, so it has to be reapplied, not set once. */
export function crisp(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = false;
}
