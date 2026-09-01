/**
 * Terrain set picker, live preview and role calibration.
 *
 * The preview is the honest part: it renders a 5x5 patch of the selected set
 * with a bite taken out of one corner, so every role the brush can emit —
 * edges, outer corners and one inner corner — is on screen at once. A
 * miscalibrated role is visible immediately rather than after painting half a
 * map.
 */

import type { Role, TerrainSet } from '../tilesets/terrain.js';
import { BLOCK_COLS, BLOCK_ROWS, ROLES, blockFrame, frameForRole, roleFor } from '../tilesets/terrain.js';
import { runByKey } from '@tillhaven/shared/config';
import { frameRect } from '../tilesets/palettes.js';
import { crisp, imageFor } from '../render/images.js';

const PREVIEW_TILES = 5;
const PREVIEW_ZOOM = 4;
const CALIBRATE_ZOOM = 3;

/** The preview shape: filled, with the top-right 2x2 cut away so the patch has
 *  four outer corners, four edges and one inner corner. */
function previewMask(x: number, y: number): boolean {
  if (x >= PREVIEW_TILES - 2 && y < 2) return false;
  return true;
}

export function renderPreview(host: HTMLElement, set: TerrainSet): void {
  const run = runByKey(set.tilesetKey);
  host.replaceChildren();
  if (!run) return;

  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_TILES * run.tileWidth * PREVIEW_ZOOM;
  canvas.height = PREVIEW_TILES * run.tileHeight * PREVIEW_ZOOM;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  crisp(ctx);
  ctx.fillStyle = '#0a0a0d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const img = imageFor(run.key);
  if (!img) {
    host.append(canvas);
    return;
  }

  for (let y = 0; y < PREVIEW_TILES; y++) {
    for (let x = 0; x < PREVIEW_TILES; x++) {
      if (!previewMask(x, y)) continue;

      // Off-patch counts as "same" only inside the patch bounds, so the outer
      // border of the preview shows edge tiles rather than fill.
      const same = (dx: number, dy: number): boolean => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= PREVIEW_TILES || ny >= PREVIEW_TILES) return false;
        return previewMask(nx, ny);
      };

      const mask =
        (same(0, -1) ? 1 : 0) | (same(1, 0) ? 2 : 0) | (same(0, 1) ? 4 : 0) | (same(-1, 0) ? 8 : 0);
      const role = roleFor(mask, {
        nw: same(-1, -1),
        ne: same(1, -1),
        sw: same(-1, 1),
        se: same(1, 1),
      });

      const frame = frameForRole(set, role);
      if (frame === undefined) continue;
      const { sx, sy, sw, sh } = frameRect(run, frame);
      ctx.drawImage(
        img,
        sx,
        sy,
        sw,
        sh,
        x * run.tileWidth * PREVIEW_ZOOM,
        y * run.tileHeight * PREVIEW_ZOOM,
        sw * PREVIEW_ZOOM,
        sh * PREVIEW_ZOOM,
      );
    }
  }

  host.append(canvas);
}

export interface CalibrateHandlers {
  onAssign(role: Role, localIndex: number): void;
}

/**
 * Role buttons plus the raw 4x4 block. Pick a role, then click the tile that
 * should serve it. Deliberately low-tech: it is a rescue hatch for a different
 * art pack, not a daily-driver UI.
 */
export function renderCalibrator(
  host: HTMLElement,
  set: TerrainSet,
  handlers: CalibrateHandlers,
): void {
  const run = runByKey(set.tilesetKey);
  host.replaceChildren();
  if (!run) return;

  let activeRole: Role = 'c';

  const roleBar = document.createElement('div');
  roleBar.className = 'role-grid';
  const roleButtons = new Map<Role, HTMLButtonElement>();

  for (const role of ROLES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const assigned = set.roles[role];
    btn.textContent = assigned === undefined ? `${role} —` : `${role} ${assigned}`;
    btn.setAttribute('aria-pressed', String(role === activeRole));
    btn.addEventListener('click', () => {
      activeRole = role;
      for (const [key, b] of roleButtons) b.setAttribute('aria-pressed', String(key === activeRole));
    });
    roleButtons.set(role, btn);
    roleBar.append(btn);
  }
  host.append(roleBar);

  const canvas = document.createElement('canvas');
  canvas.width = BLOCK_COLS * run.tileWidth * CALIBRATE_ZOOM;
  canvas.height = BLOCK_ROWS * run.tileHeight * CALIBRATE_ZOOM;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const draw = (): void => {
    crisp(ctx);
    ctx.fillStyle = '#2a2a32';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = imageFor(run.key);
    const cw = run.tileWidth * CALIBRATE_ZOOM;
    const ch = run.tileHeight * CALIBRATE_ZOOM;

    for (let local = 0; local < BLOCK_COLS * BLOCK_ROWS; local++) {
      const frame = blockFrame(set, local);
      const dx = (local % BLOCK_COLS) * cw;
      const dy = Math.floor(local / BLOCK_COLS) * ch;
      if (img && frame !== undefined) {
        const { sx, sy, sw, sh } = frameRect(run, frame);
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw * CALIBRATE_ZOOM, sh * CALIBRATE_ZOOM);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(dx + 0.5, dy + 0.5, cw - 1, ch - 1);
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = '#ffdc5a';
      ctx.fillText(String(local), dx + 3, dy + 11);
    }
  };

  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor(((ev.clientX - rect.left) / rect.width) * BLOCK_COLS);
    const row = Math.floor(((ev.clientY - rect.top) / rect.height) * BLOCK_ROWS);
    if (col < 0 || row < 0 || col >= BLOCK_COLS || row >= BLOCK_ROWS) return;
    const local = row * BLOCK_COLS + col;
    handlers.onAssign(activeRole, local);
    const btn = roleButtons.get(activeRole);
    if (btn) btn.textContent = `${activeRole} ${local}`;
    draw();
  });

  draw();
  host.append(canvas);
}
