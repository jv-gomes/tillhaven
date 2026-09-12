import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FARM_LEVEL_XP, MAX_FARM_LEVEL, levelProgress } from '@tillhaven/shared/config';
import {
  isMaxLevel,
  levelBarAriaLabel,
  levelBarLabel,
  levelBarPercent,
  xpGained,
} from './levelBar.js';

/**
 * The HUD's level bar (T-30.02).
 *
 * The arithmetic is tested against the real curve — `levelProgress` from shared
 * config, not a fixture — because a bar that agrees with a hand-written fixture
 * and disagrees with the server is exactly the bug this task exists to prevent.
 */

describe('levelBarPercent', () => {
  it('is empty at the start of a level and full at its end', () => {
    const startOfTwo = levelProgress(FARM_LEVEL_XP[1]!);
    expect(levelBarPercent(startOfTwo)).toBe(0);

    // One XP short of level 3 — the bar has essentially arrived.
    const endOfTwo = levelProgress(FARM_LEVEL_XP[2]! - 1);
    expect(levelBarPercent(endOfTwo)).toBeGreaterThanOrEqual(99);
    expect(levelBarPercent(endOfTwo)).toBeLessThanOrEqual(100);
  });

  it('is about half way at the middle of a level', () => {
    const start = FARM_LEVEL_XP[2]!;
    const mid = start + Math.floor((FARM_LEVEL_XP[3]! - start) / 2);
    const percent = levelBarPercent(levelProgress(mid));
    expect(percent).toBeGreaterThanOrEqual(49);
    expect(percent).toBeLessThanOrEqual(51);
  });

  /**
   * The cap is the case with no denominator. An empty bar would tell a player
   * who has finished the game that they have made no progress.
   */
  it('is full at the level cap, not empty', () => {
    const capped = levelProgress(FARM_LEVEL_XP[MAX_FARM_LEVEL - 1]!);
    expect(capped.nextLevelXp).toBeNull();
    expect(levelBarPercent(capped)).toBe(100);
  });

  it('never leaves the track, at any experience the game can produce', () => {
    for (const xp of [0, 1, 79, 80, 81, 5_000, 1_000_000, -1]) {
      const percent = levelBarPercent(levelProgress(xp));
      expect(percent, `xp=${xp}`).toBeGreaterThanOrEqual(0);
      expect(percent, `xp=${xp}`).toBeLessThanOrEqual(100);
      expect(Number.isFinite(percent), `xp=${xp} produced ${percent}`).toBe(true);
    }
  });

  /**
   * The clamp above is **unreachable through `levelProgress`** — break-testing
   * proved it: removing `Math.max`/`Math.min` left the previous test green,
   * because a level derived from the same experience always contains it.
   *
   * The clamp is not dead code, though. It guards the case where the two
   * disagree, which is one curve change away: retune `FARM_LEVEL_XP` and a
   * `LevelProgress` built against the old table can put experience outside the
   * level it names. So it is tested the honest way — with the inputs that
   * actually reach it, rather than with inputs that never will.
   */
  it('clamps a progress whose experience falls outside its own level', () => {
    const below = { level: 3, experience: 50, levelStartXp: 100, nextLevelXp: 200, toNextLevel: 150 };
    expect(levelBarPercent(below)).toBe(0);

    const above = { level: 3, experience: 500, levelStartXp: 100, nextLevelXp: 200, toNextLevel: 0 };
    expect(levelBarPercent(above)).toBe(100);
  });

  /**
   * A NaN width is the failure that hurts most: CSS drops the declaration, the
   * bar silently renders at its previous value, and nothing throws.
   */
  it('never produces NaN, even from a degenerate level span', () => {
    const degenerate = { level: 3, experience: 100, levelStartXp: 100, nextLevelXp: 100, toNextLevel: 0 };
    expect(Number.isNaN(levelBarPercent(degenerate))).toBe(false);
  });
});

describe('the labels', () => {
  it('names the level, and says so when there is no next one', () => {
    expect(levelBarLabel(levelProgress(0))).toBe('Lv 1');
    expect(levelBarLabel(levelProgress(FARM_LEVEL_XP[MAX_FARM_LEVEL - 1]!))).toBe(
      `Lv ${MAX_FARM_LEVEL} · max`,
    );
  });

  it('tells a screen reader what is left, not what it looks like', () => {
    const p = levelProgress(FARM_LEVEL_XP[1]!);
    const label = levelBarAriaLabel(p);
    expect(label).toContain('level 2');
    expect(label).toContain(String(p.toNextLevel));
    // The percentage is already on aria-valuenow; repeating it here would be
    // the one number a screen reader user cannot act on.
    expect(label).not.toContain('%');
  });

  it('never promises a level past the cap', () => {
    const label = levelBarAriaLabel(levelProgress(FARM_LEVEL_XP[MAX_FARM_LEVEL - 1]!));
    expect(label).not.toContain(String(MAX_FARM_LEVEL + 1));
    expect(isMaxLevel(levelProgress(FARM_LEVEL_XP[MAX_FARM_LEVEL - 1]!))).toBe(true);
    expect(isMaxLevel(levelProgress(0))).toBe(false);
  });
});

describe('xpGained', () => {
  it('is the difference between two lifetime totals', () => {
    expect(xpGained(104, 80)).toBe(24);
    expect(xpGained(9, 0)).toBe(9);
  });

  /**
   * The 20-second poll makes out-of-order arrival ordinary, not exotic: a poll
   * can land carrying experience that a still-in-flight harvest response is
   * about to report. A negative float claiming the player LOST experience —
   * which the game has no mechanic to do — is the worst possible reading.
   */
  it('never reports a loss', () => {
    expect(xpGained(80, 104)).toBe(0);
    expect(xpGained(0, 500)).toBe(0);
  });

  it('says nothing happened when nothing did', () => {
    expect(xpGained(104, 104)).toBe(0);
  });

  it('survives a total it cannot parse', () => {
    expect(xpGained(Number.NaN, 80)).toBe(0);
    expect(xpGained(104, Number.NaN)).toBe(0);
    expect(xpGained(Number.POSITIVE_INFINITY, 80)).toBe(0);
  });
});

/**
 * Markup and stylesheet have to agree, and nothing that renders one without the
 * other can see it — the same reason `hudHidden.test.ts` reads both as text.
 *
 * The specific trap: the fill's width is set from JS as an inline style. If the
 * stylesheet ever gave `.hud__track-fill` a `width` with `!important`, or the
 * element were dropped from the markup, the bar would render at a constant
 * value and every test above would still pass.
 *
 * The rule is shared with the energy meter now — both are the same widget in
 * the same three columns — so these guard both bars at once.
 */
describe('the bar is actually wired to the HUD', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const HUD_TS = readFileSync(join(HERE, 'hud.ts'), 'utf8');
  const CSS = readFileSync(join(HERE, '..', 'styles', 'hud.css'), 'utf8');

  it('renders the three elements the renderer looks up', () => {
    for (const hook of ['data-xp', 'data-level', 'data-xpfill']) {
      expect(HUD_TS, `markup is missing ${hook}`).toContain(hook);
      expect(HUD_TS, `nothing queries ${hook}`).toContain(`[${hook}]`);
    }
  });

  it('declares the progressbar role and its bounds', () => {
    expect(HUD_TS).toContain('role="progressbar"');
    expect(HUD_TS).toContain('aria-valuemin="0"');
    expect(HUD_TS).toContain('aria-valuemax="100"');
  });

  it('leaves the fill width to JS', () => {
    const fill = CSS.match(/\.hud__track-fill\s*\{[^}]*\}/)?.[0] ?? '';
    expect(fill, '.hud__track-fill rule not found').not.toBe('');
    expect(fill).not.toMatch(/width\s*:[^;]*!important/);
  });

  /**
   * A bar nobody has rendered yet must read EMPTY, not full.
   *
   * The fill is a block element, so with no `width` it fills its track — and
   * for the frame between the HUD mounting and the first poll landing, a farm
   * that has not loaded would show full energy and a completed level. The old
   * per-bar rules each carried their own initial width and the shared rule
   * dropped it; this is why it is back.
   */
  it('starts the fill empty', () => {
    const fill = CSS.match(/\.hud__track-fill\s*\{[^}]*\}/)?.[0] ?? '';
    expect(fill).toMatch(/width:\s*0\s*;/);
  });

  /** Decoration stops when asked to (the project's standing rule). */
  it('drops the fill transition under reduced motion', () => {
    const reduced = CSS.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.hud__track-fill\s*\{[^}]*\}/,
    );
    expect(reduced, 'no reduced-motion rule for .hud__track-fill').not.toBeNull();
  });

  /**
   * The two meters must not be told apart by colour alone.
   *
   * They were: a green bar and a cyan bar, with the level pip wearing the
   * pack's cyan tag directly above the cyan energy fill. A star and a heart
   * from the icon vocabulary carry the distinction now, and colour confirms it.
   */
  it('gives each meter a glyph, not just a colour', () => {
    const glyphs = HUD_TS.match(/class="ui-icon hud__meter-glyph" style="--icon-col: (\d+)"/g) ?? [];
    expect(glyphs, 'both meters need a glyph').toHaveLength(2);
    expect(new Set(glyphs).size, 'the two glyphs must differ').toBe(2);
  });
});
